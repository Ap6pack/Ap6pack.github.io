#!/usr/bin/env python3
"""Strip the honeypot's own identity out of the published replays.

Covers both formats the export produces:

    redact-replay.py DATADIR                     # session_replay.json + replays/*.cast
    redact-replay.py path/session_replay.json    # one JSON replay
    redact-replay.py path/abc123.cast            # one asciinema cast

WHY THE .cast FILES MATTER

They were added to the export on 2026-08-30 for the terminal-replay player, and
they arrived carrying the same hostname the JSON replay had already been cleaned
of: 4,404 occurrences of ip-172-31-80-180 across 95 of 104 files, live on the
public site. Redacting one of two formats is not redacting.

ORIGINAL NOTE
-------------

Strip the honeypot's own identity out of session_replay.json before publishing.

RUNS ON THE BOX, NOT IN THE BUILD
---------------------------------

This is the one script in this repository that is not part of `npm run build`.
It belongs to the export pipeline on the honeypot machine, which does not live
here yet (see MIGRATION.md). It is kept in the repo anyway so the redaction is
version-controlled and reviewable rather than a paste that exists only on one
box, and so it is already in place when the pipeline does move over.

WHY
---

Cowrie echoes its configured hostname in the shell prompt, and that hostname was
the instance's real EC2 internal name:

    admin@ip-172-31-80-180:/root$

1,176 of the 34,023 events in the published replay carried it - the landing page
of the site, on the most prominent element it has. It is an RFC 1918 name, so
the risk is small, but it is our infrastructure showing through the attacker's
screen and there is no reason to publish it.

WHY NOT IN THE BROWSER
----------------------

session_replay.json is a public static file, and the dashboard's own About page
invites people to fetch the raw JSON directly. Redacting in the browser hides
the hostname on the page and leaves it one curl away, which is not a redaction.

WHY NOT BY HAND
---------------

The box regenerates this file every 30 minutes, so editing the published copy is
overwritten on the next sync. That is exactly what happened with the operator's
residential address in geo.json on 2026-08-29: the manual deletion only held
because the box's EXCLUDED_IPS list was fixed at the same time.

THE REAL FIX IS UPSTREAM OF THIS
--------------------------------

Set `hostname` in cowrie.cfg to something that is not the instance's own name
(Cowrie ships with `svr04`), and nothing captured from then on contains it. This
script then only matters for sessions already recorded - but it is worth keeping
after that, because it costs nothing and catches a config that gets reset or a
box that gets reprovisioned.

USAGE
-----

    redact-replay.py path/to/session_replay.json      # rewrite in place
    redact-replay.py in.json -o out.json              # write elsewhere
    cat in.json | redact-replay.py - > out.json       # or pipe it

Idempotent: running it twice changes nothing the second time.
"""

import argparse
import glob
import json
import os
import re
import sys

# What the fake host is called in published output. Deliberately not an
# EC2-shaped name, so a redacted prompt does not look like a redacted prompt.
REPLACEMENT_HOST = "honeypot-01"

# Every form the machine's own identity could reach the transcript in. Only the
# first of these appears in the current capture; the rest are here because an
# attacker running `ifconfig`, or probing the instance metadata service, would
# put them there - and a redaction that only covers the form you have already
# seen is the kind that fails quietly.
PATTERNS = [
    # EC2 internal hostname, e.g. ip-172-31-80-180
    (re.compile(r"\bip-\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}\b"), REPLACEMENT_HOST),
    # AWS internal DNS, e.g. ip-172-31-80-180.ec2.internal
    (re.compile(r"\b[\w.-]+\.(?:compute|ec2)\.internal\b"), REPLACEMENT_HOST),
    # RFC 1918 addresses, which on this box means its own private address
    (re.compile(r"\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b"), "10.0.0.1"),
    (re.compile(r"\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b"), "172.16.0.1"),
    (re.compile(r"\b192\.168\.\d{1,3}\.\d{1,3}\b"), "192.168.0.1"),
    # The instance metadata service. Attackers probe 169.254.169.254 for
    # credentials, and whatever comes back is not something to republish.
    (re.compile(r"\b169\.254\.\d{1,3}\.\d{1,3}\b"), "169.254.0.1"),
    # Anything naming an AWS-hosted endpoint
    (re.compile(r"\b[\w.-]+\.amazonaws\.com\b"), "cloud.invalid"),
]


def redact(text):
    """Apply every pattern to one string."""
    for pattern, replacement in PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def redact_replay(replay):
    """Redact a parsed replay document in place. Returns the number of edits."""
    edits = 0
    for event in replay.get("events", []):
        original = event.get("text", "")
        cleaned = redact(original)
        if cleaned != original:
            event["text"] = cleaned
            edits += 1
    return edits


def redact_cast(path):
    """Redact one asciinema v2 cast file. Returns (edits, lines).

    Substitution is done on the raw text rather than by re-serialising each
    line. Every pattern above matches only ASCII that carries no meaning inside
    a JSON string, and every replacement is likewise plain, so the edit cannot
    change the framing - and re-serialising would risk rewriting the float
    timings, which are the one thing in this file that must not move.

    The result is parsed back afterwards to prove that is true.
    """
    original = open(path, encoding="utf-8").read()
    cleaned = redact(original)
    if cleaned == original:
        return 0, 0

    lines = [line for line in cleaned.split("\n") if line.strip()]
    for number, line in enumerate(lines, 1):
        try:
            json.loads(line)
        except ValueError as exc:
            raise ValueError(f"{path}: line {number} stopped being valid JSON — {exc}")

    edits = sum(
        1
        for before, after in zip(original.split("\n"), cleaned.split("\n"))
        if before != after
    )
    return edits, lines


def collect(path):
    """The replay files under a path, whether it is a directory or one file."""
    if os.path.isdir(path):
        found = []
        replay = os.path.join(path, "session_replay.json")
        if os.path.isfile(replay):
            found.append(replay)
        found.extend(sorted(glob.glob(os.path.join(path, "replays", "*.cast"))))
        found.extend(sorted(glob.glob(os.path.join(path, "*.cast"))))
        return found
    return [path]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "path",
        help="the export directory, a session_replay.json, a .cast file, or - for stdin",
    )
    parser.add_argument("-o", "--output", help="write here instead of in place (single file only)")
    parser.add_argument(
        "--check",
        action="store_true",
        help="report what would change and exit 1 if anything would, without writing",
    )
    args = parser.parse_args()

    if args.path == "-":
        replay = json.load(sys.stdin)
        edits = redact_replay(replay)
        if args.check:
            print(f"redact-replay: {edits} event(s) would be redacted", file=sys.stderr)
            return 1 if edits else 0
        json.dump(replay, sys.stdout, separators=(",", ":"))
        return 0

    targets = collect(args.path)
    if not targets:
        print(f"redact-replay: nothing to redact under {args.path}", file=sys.stderr)
        return 0

    total_edits, touched = 0, []

    for target in targets:
        if target.endswith(".cast"):
            try:
                edits, _ = redact_cast(target)
            except ValueError as exc:
                print(f"redact-replay: {exc}", file=sys.stderr)
                print("  nothing written for this file.", file=sys.stderr)
                return 1
            if edits and not args.check:
                cleaned = redact(open(target, encoding="utf-8").read())
                tmp = target + ".tmp"
                with open(tmp, "w", encoding="utf-8") as handle:
                    handle.write(cleaned)
                os.replace(tmp, target)
        else:
            with open(target, encoding="utf-8") as handle:
                replay = json.load(handle)
            edits = redact_replay(replay)
            if edits and not args.check:
                destination = args.output or target
                tmp = destination + ".tmp"
                with open(tmp, "w", encoding="utf-8") as handle:
                    json.dump(replay, handle, separators=(",", ":"))
                os.replace(tmp, destination)

        if edits:
            total_edits += edits
            touched.append(os.path.basename(target))

    noun = "line" if any(t.endswith(".cast") for t in touched) else "event"
    if args.check:
        if total_edits:
            print(
                f"redact-replay: {total_edits:,} {noun}(s) would be redacted across "
                f"{len(touched)} file(s)",
                file=sys.stderr,
            )
            for name in touched[:5]:
                print(f"    {name}", file=sys.stderr)
            if len(touched) > 5:
                print(f"    ... and {len(touched) - 5} more", file=sys.stderr)
            return 1
        print(f"redact-replay: {len(targets)} file(s) already clean", file=sys.stderr)
        return 0

    if total_edits:
        print(
            f"redact-replay: redacted {total_edits:,} {noun}(s) across {len(touched)} "
            f"of {len(targets)} file(s)",
            file=sys.stderr,
        )
    else:
        print(f"redact-replay: {len(targets)} file(s) already clean", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
