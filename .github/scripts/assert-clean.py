#!/usr/bin/env python3
"""Fail if the sensor's own identity reached anything published.

    assert-clean.py DATADIR [--db DB]      # exit 1 on any leak

WHY THIS EXISTS SEPARATELY FROM redact-replay.py

Because cleaning and proving are different jobs, and this project has already
watched the difference matter. redact-replay.py was written against
session_replay.json. When per-session .cast transcripts appeared, its coverage
went from complete to partial and *nothing failed* - 4,404 occurrences of the
instance's own hostname shipped across 95 of 104 files, and were found by
someone reading a page rather than by anything automated.

A cleaner that is pointed at a list of files silently stops covering whatever
is not on the list. An assertion that walks everything published cannot: it
either finds the string or the build stays green. So this checks the *output*,
over the whole directory, including the SQLite database's text columns and the
raw bytes of its shards - not the inputs any particular script knew about.

WHAT IS A LEAK AND WHAT IS DATA

The distinction matters, because over-blocking here is not "safe". A honeypot
publishes what attackers typed, and attackers type things that look alarming.

  FAILS   The sensor's own identity: an EC2-internal hostname, an internal DNS
          suffix, the instance's addresses. An attacker has no reason to type
          our internal hostname, so any occurrence is our output, not theirs.

  REPORTS Cloud metadata endpoints such as 169.254.169.254. Probing those is
          real, interesting attacker behaviour and belongs in the dataset.
          Failing on it would delete the finding to protect nothing, so it is
          counted and printed, never fatal.

The published dataset is currently clean. This exists so it stays that way
without anyone having to notice.
"""

import argparse
import json
import os
import re
import sqlite3
import sys

# Our identity. None of these can be attacker-supplied in any sane reading:
# nobody types the sensor's internal hostname at the sensor.
FATAL = [
    ("ec2 internal hostname", re.compile(rb"\bip-\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}\b")),
    ("internal dns suffix", re.compile(rb"\b[\w.-]+\.(?:compute|ec2)\.internal\b")),
    ("ec2 public dns", re.compile(rb"\bec2-\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}[\w.-]*\.amazonaws\.com\b")),
]

# Real attacker behaviour that merely looks like a leak. Counted, never fatal.
NOTED = [
    ("cloud metadata endpoint", re.compile(rb"169\.254\.169\.254")),
]

# Compressed or already-quarantined payloads. Malware samples are third-party
# bytes in password-protected zips; scanning them for our hostname would match
# on compressed noise and tell us nothing.
SKIP_DIRS = {"samples"}
SKIP_SUFFIX = (".zip", ".gz", ".wasm")


def scan_bytes(blob, where, fatal_hits, noted_hits):
    for label, pattern in FATAL:
        for m in pattern.finditer(blob):
            fatal_hits.append((where, label, m.group(0).decode("utf-8", "replace")))
    for label, pattern in NOTED:
        for m in pattern.finditer(blob):
            noted_hits.append((where, label, m.group(0).decode("utf-8", "replace")))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("data", help="the export directory")
    ap.add_argument("--db", help="the assembled database, scanned column by column as well")
    args = ap.parse_args()

    fatal_hits, noted_hits = [], []
    files = 0

    for base, dirs, names in os.walk(args.data):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in names:
            if name.endswith(SKIP_SUFFIX):
                continue
            path = os.path.join(base, name)
            try:
                with open(path, "rb") as fh:
                    blob = fh.read()
            except OSError:
                continue
            files += 1
            scan_bytes(blob, os.path.relpath(path, args.data), fatal_hits, noted_hits)

    # The shards above are scanned as raw bytes, which finds a hostname sitting
    # in a page but can miss one split across a shard boundary. Walking the
    # assembled database's text columns catches that, and says which column.
    columns = 0
    if args.db and os.path.isfile(args.db):
        db = sqlite3.connect(args.db)
        tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        for table in tables:
            for col in [c[1] for c in db.execute(f'PRAGMA table_info("{table}")')]:
                try:
                    rows = db.execute(f'SELECT "{col}" FROM "{table}" WHERE "{col}" IS NOT NULL')
                except sqlite3.Error:
                    continue
                columns += 1
                for (value,) in rows:
                    if isinstance(value, str):
                        scan_bytes(value.encode(), f"db:{table}.{col}", fatal_hits, noted_hits)

    print(f"assert-clean: scanned {files} files" + (f" and {columns} database columns" if columns else ""),
          file=sys.stderr)

    if noted_hits:
        seen = {}
        for where, label, value in noted_hits:
            seen.setdefault((label, value), set()).add(where)
        for (label, value), wheres in seen.items():
            print(f"    note: {label} {value} in {len(wheres)} file(s) - attacker behaviour, kept",
                  file=sys.stderr)

    if not fatal_hits:
        print("assert-clean: no sensor identity in published data", file=sys.stderr)
        return 0

    seen = {}
    for where, label, value in fatal_hits:
        seen.setdefault((label, value), []).append(where)
    print(f"assert-clean: FAILED - {len(fatal_hits)} occurrence(s) of the sensor's own identity",
          file=sys.stderr)
    for (label, value), wheres in sorted(seen.items(), key=lambda kv: -len(kv[1])):
        sample = ", ".join(sorted(set(wheres))[:4])
        more = len(set(wheres)) - 4
        print(f"    {label}: {value}  in {len(wheres)} place(s): {sample}"
              + (f" (+{more} more)" if more > 0 else ""), file=sys.stderr)
    print("\n    Fix the redaction, not this check. See scripts/redact-replay.py.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
