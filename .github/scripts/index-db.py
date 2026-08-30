#!/usr/bin/env python3
"""Add the index the dashboard needs to the built SQLite database.

RUNS ON THE HONEYPOT SERVER, NOT IN THE BUILD
---------------------------------------------

Like scripts/redact-replay.py, this belongs to the export pipeline on the
honeypot machine rather than to `npm run build`. It is kept in this repository
so the change is version-controlled and reviewable.

Run it against the assembled database *before* it is split into shards:

    index-db.py path/to/honeypot.db

Idempotent, and safe to run on every publish - it exits without writing if the
index already exists.

WHAT IT BUYS, MEASURED
----------------------

Against the published database, driven in Chromium over the same Range-request
setup the dashboard uses, a 7-day browse on the Explore tab:

                          before        after
    bytes over the wire   2,358 KB      1,565 KB
    range requests            959          185

Credentials-by-window previously had to reach its rows one seek per session
through the UNIQUE(session_id, ts, username, password) index. Walking a ts index
instead removes 774 of the 959 range requests that page made.

TWO THINGS THAT ARE EASY TO GET WRONG HERE
------------------------------------------

The dashboard has to name this index explicitly with INDEXED BY. sql.js-httpvfs
pins SQLite 3.35.0, and that planner will not choose it on its own - it picks a
full scan through idx_logins_username instead, even with ANALYZE run and
statistics present. A newer SQLite chooses correctly unaided, so this looks fine
on a workstation and ships broken.

ANALYZE is therefore not run here. It was measured and changed nothing the
browser acts on. It is left out rather than carried as cargo.

WHAT WAS TRIED AND REMOVED
--------------------------

An earlier version of this script also created a covering index on
downloads(shasum, ip_id, url) for the Samples provenance join, on the strength
of a measurement showing 1,130 KB dropping to 677 KB. Re-measured against the
current published database, over HTTP, three runs of each with no variance
between runs:

    published, no extra index      2,687 KB    80 requests
    idx_logins_ts only             2,687 KB    80 requests
    plus the covering index        2,809 KB   103 requests

It costs 122 KB and buys nothing - roughly its own size on disk, 138 KB. The
reason is that `downloads` is small: 1,725 rows, 1,265 of them with a shasum, so
its rows already sit within a few pages. Reading them directly through
idx_downloads_shasum is cheaper than walking a separate b-tree spread across an
85 MB file. A covering index avoids row reads, but row reads were never the
expensive part here.

Do not add VACUUM either. Measured for the same reason and worse: repacking
pushes the Samples page to 3,199 KB, another 390 KB, because it reorders pages
the join was reaching cheaply.

COST
----

About +3.2 MB on an 85 MB database, roughly 3.9%. That is not free: the database
is republished several times a day into a git repository, and a rebuild reorders
pages, so the added size is paid on every sync rather than once.
"""

import argparse
import sqlite3
import sys

INDEXES = [
    (
        "idx_logins_ts",
        "CREATE INDEX idx_logins_ts ON logins(ts)",
        "credentials by time window",
    ),
]


def existing(db):
    names = tuple(name for name, _, _ in INDEXES)
    rows = db.execute(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (%s)"
        % ",".join("?" * len(names)),
        names,
    )
    return {row[0] for row in rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("path", help="the assembled honeypot.db, before sharding")
    parser.add_argument(
        "--check",
        action="store_true",
        help="report what is missing and exit 1 if anything is, without writing",
    )
    args = parser.parse_args()

    db = sqlite3.connect(args.path)
    have = existing(db)
    missing = [(n, sql, why) for n, sql, why in INDEXES if n not in have]

    if args.check:
        for name, _, why in INDEXES:
            state = "present" if name in have else "MISSING"
            print(f"index-db: {name:26} {state:8} — {why}", file=sys.stderr)
        return 1 if missing else 0

    if not missing:
        print("index-db: index already present, nothing to do", file=sys.stderr)
        return 0

    for name, sql, why in missing:
        db.execute(sql)
        print(f"index-db: created {name} — {why}", file=sys.stderr)
    db.commit()

    # Cheap insurance: a database that fails integrity_check must not be
    # published, and this is the last point at which it is one file.
    ok = db.execute("PRAGMA integrity_check").fetchone()[0]
    if ok != "ok":
        print(f"index-db: integrity_check returned {ok!r} — NOT safe to publish", file=sys.stderr)
        return 1

    print("index-db: integrity_check ok", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
