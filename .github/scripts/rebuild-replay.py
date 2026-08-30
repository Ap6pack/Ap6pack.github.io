#!/usr/bin/env python3
"""Rebuild session_replay.json from a better session. One command, no edits.

RUNS ON THE HONEYPOT MACHINE
----------------------------

This is the one job that cannot be done from the published data. The database
records where each transcript lives - `var/lib/cowrie/tty/58813c5e...` - but not
what is in it, so the bytes exist only on the machine Cowrie runs on.

    rebuild-replay.py --dry-run          # find everything, change nothing
    rebuild-replay.py                    # write the new replay

It locates the database, the ttylog directory and the export directory itself,
prints what it found, and stops if anything is missing. Nothing has to be passed
unless the guesses are wrong, and every guess can be overridden:

    rebuild-replay.py --db /path/honeypot.db --tty-root / --out /path/data

WHY THE CURRENT REPLAY IS THE WRONG ONE
---------------------------------------

The exporter picks the largest session. Size correlates with repetition, not
interest, so the front page gets a bot printing every busybox applet name -
1,001,186 bytes of it, under a hero paragraph promising "a real captured
attacker session". It also grows without bound, because the rule guarantees the
next winner is bigger.

This ranks the way pick-replay.py does: sessions that downloaded something
first, then suspected AI agents, then distinct commands, then recency, capped at
a 256 KB transcript. On the published data that is 12 downloads and 28 distinct
commands in about 11 KB.

WHAT IT WRITES

The same shape the exporter writes, so nothing downstream changes:

    {"src_ip": ..., "timestamp": ..., "duration_ms": ..., "events": [...]}

with each event {"t": seconds from the start, "dir": "input"|"output",
"text": ...}. The hostname redaction from redact-replay.py is applied inline, so
the file is safe to publish as written - there is no second step to forget.

The old file is kept as session_replay.json.bak.
"""

import argparse
import glob
import json
import os
import re
import struct
import sys

# Cowrie's ttylog record header: op, direction, seconds, microseconds, length.
# A write record is followed by `length` bytes of payload.
HEADER = struct.Struct("<iiiii")
OP_OPEN, OP_CLOSE, OP_WRITE, OP_EXEC = 1, 2, 3, 4
TYPE_INPUT, TYPE_OUTPUT, TYPE_INTERACT = 1, 2, 3

MAX_TTYLOG = 256 * 1024

# Where Cowrie and the export usually live. Only used to make the arguments
# optional; anything found here is printed before it is used.
DB_GUESSES = [
    "honeypot.db",
    "data/honeypot.db",
    "export/honeypot.db",
    "~/honeypot/honeypot.db",
    "~/cowrie-dashboard/honeypot.db",
    "/opt/honeypot/honeypot.db",
    "/srv/honeypot/honeypot.db",
]
TTY_ROOT_GUESSES = ["/", "/home/cowrie/cowrie", "/opt/cowrie", "/srv/cowrie", "~/cowrie"]

CANDIDATES = f"""
SELECT s.id, s.ttylog, s.ttylog_size, s.duration_ms, s.started_at, i.ip,
       (SELECT COUNT(*) FROM downloads d
         WHERE d.session_id = s.id AND d.shasum IS NOT NULL)         AS downloads,
       (SELECT COUNT(DISTINCT sc.command_id) FROM session_commands sc
         WHERE sc.session_id = s.id)                                 AS distinct_commands
FROM sessions s
JOIN ips i ON i.id = s.ip_id
WHERE s.ttylog IS NOT NULL AND s.ttylog_size IS NOT NULL
  AND s.ttylog_size <= {MAX_TTYLOG} AND s.command_count > 0
ORDER BY downloads DESC, (i.ai_agent_signal IS NOT NULL) DESC,
         distinct_commands DESC, s.started_at DESC
LIMIT 40
"""


def say(msg):
    print(msg, file=sys.stderr)


def parse_ttylog(path):
    """Cowrie ttylog -> [(offset_seconds, "input"|"output", text)].

    Validated rather than trusted: a file that does not decode as a ttylog is
    rejected outright instead of producing a plausible-looking wrong replay.
    """
    raw = open(path, "rb").read()
    events, pos, start = [], 0, None

    while pos + HEADER.size <= len(raw):
        op, direction, sec, usec, length = HEADER.unpack_from(raw, pos)
        pos += HEADER.size

        if op not in (OP_OPEN, OP_CLOSE, OP_WRITE, OP_EXEC):
            raise ValueError(f"unknown op {op} at byte {pos - HEADER.size}")
        if length < 0 or pos + length > len(raw):
            raise ValueError(f"record length {length} runs past the end of the file")

        stamp = sec + usec / 1_000_000
        if start is None:
            start = stamp

        if op == OP_WRITE and length:
            payload = raw[pos : pos + length]
            if direction == TYPE_INPUT:
                where = "input"
            elif direction == TYPE_OUTPUT:
                where = "output"
            else:
                where = "input"  # TYPE_INTERACT is the attacker's side too
            events.append(
                (round(stamp - start, 3), where, payload.decode("utf-8", "replace"))
            )
        pos += length

    if not events:
        raise ValueError("no write records found")
    return events


# The same substitutions redact-replay.py makes, applied as the file is built so
# the result is publishable without a second pass.
REPLACEMENT_HOST = "honeypot-01"
REDACTIONS = [
    (re.compile(r"\bip-\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}\b"), REPLACEMENT_HOST),
    (re.compile(r"\b[\w.-]+\.ec2\.internal\b"), REPLACEMENT_HOST),
    (re.compile(r"\b[\w.-]*\.compute\.amazonaws\.com\b"), REPLACEMENT_HOST),
    (re.compile(r"\b[\w.-]*\.amazonaws\.com\b"), REPLACEMENT_HOST),
    (re.compile(r"\b169\.254\.\d{1,3}\.\d{1,3}\b"), "169.254.0.0"),
    (re.compile(r"\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b"), "10.0.0.0"),
    (re.compile(r"\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b"), "172.16.0.0"),
    (re.compile(r"\b192\.168\.\d{1,3}\.\d{1,3}\b"), "192.168.0.0"),
]


def redact(text):
    for pattern, replacement in REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


def first_existing(candidates, *, isdir=False):
    for candidate in candidates:
        path = os.path.expanduser(candidate)
        if (os.path.isdir if isdir else os.path.isfile)(path):
            return os.path.abspath(path)
    return None


def find_ttylog(tty_root, recorded):
    """Locate the transcript the database points at.

    `recorded` is a path as Cowrie stored it, usually relative and rooted at
    var/. Try it under the given root, then fall back to finding the basename,
    because installs disagree about where var/ lives.
    """
    recorded = recorded.lstrip("/")
    direct = os.path.join(tty_root, recorded)
    if os.path.isfile(direct):
        return direct
    name = os.path.basename(recorded)
    for pattern in (
        os.path.join(tty_root, "**", "tty", name),
        os.path.join(tty_root, "**", name),
    ):
        hits = glob.glob(pattern, recursive=True)
        if hits:
            return hits[0]
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--db", help="the assembled honeypot.db")
    parser.add_argument("--tty-root", help="directory holding Cowrie's var/lib/cowrie/tty")
    parser.add_argument("--out", help="the export directory holding session_replay.json")
    parser.add_argument("--session", help="use this session id instead of choosing one")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what was found and what would be written, without writing",
    )
    args = parser.parse_args()

    import sqlite3

    db_path = os.path.abspath(os.path.expanduser(args.db)) if args.db else first_existing(DB_GUESSES)
    if not db_path:
        say("rebuild-replay: could not find honeypot.db. Pass --db /path/to/honeypot.db")
        say("  (looked in: " + ", ".join(DB_GUESSES) + ")")
        return 1
    say(f"rebuild-replay: database   {db_path}")

    out_dir = os.path.abspath(os.path.expanduser(args.out)) if args.out else None
    if not out_dir:
        near = os.path.join(os.path.dirname(db_path), "data")
        out_dir = near if os.path.isfile(os.path.join(near, "session_replay.json")) else os.path.dirname(db_path)
    replay_path = os.path.join(out_dir, "session_replay.json")
    if not os.path.isfile(replay_path):
        say(f"rebuild-replay: no session_replay.json in {out_dir}. Pass --out /path/to/export-dir")
        return 1
    say(f"rebuild-replay: export     {replay_path}")

    tty_root = os.path.abspath(os.path.expanduser(args.tty_root)) if args.tty_root else None

    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    rows = db.execute(CANDIDATES).fetchall()
    if args.session:
        rows = [r for r in db.execute(
            CANDIDATES.replace("LIMIT 40", "LIMIT 500")) if r["id"] == args.session] or rows

    chosen = None
    for row in rows:
        roots = [tty_root] if tty_root else [os.path.expanduser(g) for g in TTY_ROOT_GUESSES]
        for root in roots:
            if not root or not os.path.isdir(root):
                continue
            found = find_ttylog(root, row["ttylog"])
            if found:
                chosen, tty_path = row, found
                break
        if chosen:
            break

    if not chosen:
        say("rebuild-replay: found candidate sessions but none of their transcripts on disk.")
        say(f"  the database points at, for example: {rows[0]['ttylog'] if rows else 'nothing'}")
        say("  pass --tty-root with the directory that contains var/lib/cowrie/tty")
        return 1

    say(f"rebuild-replay: transcript {tty_path}")
    say(
        f"rebuild-replay: chose {chosen['id']} — {chosen['downloads']} downloads, "
        f"{chosen['distinct_commands']} distinct commands, {chosen['ttylog_size']:,} bytes, "
        f"from {chosen['ip']} at {chosen['started_at']}"
    )

    try:
        events = parse_ttylog(tty_path)
    except (ValueError, struct.error) as exc:
        say(f"rebuild-replay: {tty_path} does not decode as a Cowrie ttylog — {exc}")
        say("  nothing written. This is deliberate: a wrong replay is worse than the old one.")
        return 1

    redacted = sum(1 for _, _, text in events if redact(text) != text)
    doc = {
        "src_ip": chosen["ip"],
        "timestamp": chosen["started_at"],
        "duration_ms": chosen["duration_ms"],
        "events": [{"t": t, "dir": d, "text": redact(text)} for t, d, text in events],
    }

    old = os.path.getsize(replay_path)
    body = json.dumps(doc, separators=(",", ":"))
    say(
        f"rebuild-replay: {len(events):,} events, {redacted:,} redacted; "
        f"{old:,} bytes -> {len(body):,} ({old / max(len(body), 1):.0f}x smaller)"
    )

    if args.dry_run:
        say("rebuild-replay: --dry-run, nothing written")
        return 0

    os.replace(replay_path, replay_path + ".bak")
    with open(replay_path, "w", encoding="utf-8") as fh:
        fh.write(body)
    say(f"rebuild-replay: wrote {replay_path} (previous kept as session_replay.json.bak)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
