#!/usr/bin/env python3
"""Record what the published database actually contains, beside what was captured.

    reconcile-stats.py DATADIR           # add a `published` block to stats.json
    reconcile-stats.py DATADIR --check   # report the gap, write nothing

THE PROBLEM

stats.json describes the whole capture. The database shipped beside it is a
pruned subset - smaller on purpose, because it is fetched over HTTP a megabyte
at a time. On 2026-08-30 the pruning took it from 89 MB to 11.9 MB, and the two
files stopped describing the same thing:

    stats.json says   97,439 sessions   93,795 logins   176,885 commands
    the database has   7,468 sessions    3,051 logins    17,765 commands

Both numbers are true. Neither file said which question it was answering, so the
Overview tile read 97,439 and the page it links to found 7,468 - the same defect
as OV-4, an order of magnitude worse.

WHY NOT JUST OVERWRITE THE TOTALS

Because the capture total is the more impressive and equally real fact, and
throwing it away to make two numbers agree is the lazy repair. What was missing
was not a correction but a distinction, so this adds one rather than choosing a
winner:

    "unique_sessions": 97439,          <- unchanged, what the honeypot saw
    "published": {                     <- new, what this database can answer
        "sessions": 7468,
        "source_ips": 2254,
        "login_attempts": 3051,
        "login_success": 2563,
        "commands_run": 17765,
        "share_of_sessions": 0.0766
    }

The dashboard shows the published figure on any tile that links to a page
backed by the database, and states the capture total beside it. A number you
cannot click through to is not a number the reader can check.

IDEMPOTENT

Re-running on an already-reconciled export rewrites the same values, so the file
is byte-identical and CI commits nothing.
"""

import argparse
import json
import os
import sqlite3
import sys

# Each published figure, and the query that answers it from the shipped database.
FIGURES = [
    ("sessions", "SELECT COUNT(*) FROM sessions"),
    ("source_ips", "SELECT COUNT(*) FROM ips"),
    ("login_attempts", "SELECT COUNT(*) FROM logins"),
    ("login_success", "SELECT COUNT(*) FROM logins WHERE success = 1"),
    ("commands_run", "SELECT COUNT(*) FROM session_commands"),
]


# The credential charts are drawn from these lists, and their percentages are
# taken against the published attempt count. Leaving the lists describing the
# whole capture while the denominator describes the database produced "219% of
# all 3,051 attempts" - a numerator and a denominator from different
# populations. They are recomputed here so both halves come from one place.
TOP_LISTS = [
    ("top_usernames", "SELECT username, COUNT(*) n FROM logins GROUP BY username ORDER BY n DESC LIMIT ?"),
    ("top_passwords", "SELECT password, COUNT(*) n FROM logins GROUP BY password ORDER BY n DESC LIMIT ?"),
]


def measure(db_path):
    db = sqlite3.connect(db_path)
    out = {}
    for name, sql in FIGURES:
        try:
            out[name] = db.execute(sql).fetchone()[0]
        except sqlite3.Error:
            # A column the schema does not have yet is not a reason to fail; the
            # dashboard treats a missing figure as "no published count for this".
            pass
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("data", help="the export directory holding stats.json")
    parser.add_argument("--db", help="the assembled database (default: joined from data/db)")
    parser.add_argument(
        "--check",
        action="store_true",
        help="report the gap and exit 1 if stats.json would change, without writing",
    )
    args = parser.parse_args()

    stats_path = os.path.join(args.data, "stats.json")
    if not os.path.isfile(stats_path):
        print(f"reconcile-stats: no stats.json in {args.data}", file=sys.stderr)
        return 1

    db_path = args.db
    if not db_path:
        print("reconcile-stats: --db is required (join the shards first)", file=sys.stderr)
        return 1

    with open(stats_path) as fh:
        stats = json.load(fh)

    published = measure(db_path)
    captured = stats.get("unique_sessions") or 0
    if captured and "sessions" in published:
        published["share_of_sessions"] = round(published["sessions"] / captured, 4)

    was = stats.get("published")
    stats["published"] = published

    # Recompute the top lists from the same database, keeping however many
    # entries the exporter chose to publish.
    db = sqlite3.connect(db_path)
    lists_changed = []
    for key, sql in TOP_LISTS:
        existing = stats.get(key)
        if not isinstance(existing, list) or not existing:
            continue
        try:
            rows = db.execute(sql, (len(existing),)).fetchall()
        except sqlite3.Error:
            continue
        rebuilt = [[value if value is not None else "", count] for value, count in rows]
        if rebuilt != existing:
            lists_changed.append(key)
        stats[key] = rebuilt

    pairs = [
        ("sessions", "unique_sessions"),
        ("source_ips", "unique_source_ips"),
        ("login_attempts", "login_attempts"),
        ("commands_run", "commands_run"),
    ]
    print("reconcile-stats: captured vs published", file=sys.stderr)
    for key, top in pairs:
        if key in published:
            a, b = stats.get(top), published[key]
            flag = "" if a == b else f"   ({a / max(b, 1):.1f}x)"
            print(f"    {top:20} {a:>9,}   ->  {b:>9,}{flag}", file=sys.stderr)

    for key in lists_changed:
        print(f"    {key} recomputed from the published logins", file=sys.stderr)

    if was == published and not lists_changed:
        print("reconcile-stats: already reconciled, nothing to do", file=sys.stderr)
        return 0

    if args.check:
        print("reconcile-stats: stats.json would be updated", file=sys.stderr)
        return 1

    tmp = stats_path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(stats, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, stats_path)
    print("reconcile-stats: stats.json now carries a `published` block", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
