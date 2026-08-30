#!/usr/bin/env python3
"""Build the per-day rollup the dashboard uses to rank wide windows.

RUNS ON THE BOX, NOT IN THE BUILD
---------------------------------

Like redact-replay.py and index-db.py, this belongs to the export pipeline on
the honeypot machine. Run it against the assembled database before sharding,
after index-db.py:

    build-rollups.py path/to/honeypot.db

It drops and rebuilds the table each time, so it is safe on every publish.

WHY THIS IS ABOUT CORRECTNESS, NOT SPEED
----------------------------------------

Explore ranks a time window by reading the most recent 500 sessions in it. That
is bounded and honest - the page says so - but on a wide window it is also
wrong, because the busiest host may not have been active recently.

Ranking the last 30 days on the published data:

    from the 500-session sample   219.251.24.135      600 commands
    from this rollup              112.26.45.228    40,833 commands

The sample misses the most active host on the honeypot by a factor of 68,
because that host's traffic is not in the most recent 500 sessions. The rollup
sees every day.

It is cheaper too, though that is the smaller point: a 30-day ranking costs
87 KB over 37 range requests against 136 KB over 136, and 93 ms against 328.

WHAT ELSE IT BUILDS
-------------------

hourly_activity: 24 rows, one per hour of the UTC day, carrying sessions and
commands. About 1 KB, and it is what makes an hour-of-day view possible at all -
computing it in the browser means reading started_at for every session, which is
the whole table.

It is worth having for what it shows rather than for the bytes. Session volume
across the day is fairly flat, varying about 2.9x between the quietest hour
(10:00, 2,187 sessions) and the busiest (13:00, 6,287). Commands per session is
not flat: roughly 1.4 in the early hours against 2.2 between 13:00 and 21:00.
The connections arrive around the clock; the ones where somebody actually types
something cluster into a working day.

WHAT IT DOES NOT COVER, AND WHY
-------------------------------

Two other rollups were measured and rejected:

  - Commands. `uses` sums across days correctly, but `distinct_ips` does not -
    the same address on two days would be counted twice - and the dashboard
    shows both. A rollup that makes one of its two columns quietly wrong is
    worse than no rollup.

  - Credentials. 56,056 day-by-pair rows against 87,437 logins is a 1.6x
    reduction, which buys nothing. Credentials are served instead by a capped
    scan of idx_logins_ts, at 59 KB flat - see index-db.py.

DAY GRANULARITY
---------------

Buckets are whole UTC days, so this can only answer windows measured in days.
The dashboard uses it for ranges spanning two or more days and keeps the exact
session-level path for anything narrower, where the sample is not a sample -
under 500 sessions it is the whole window.

COST
----

daily_ips is 2,379 rows, about 55 KB. hourly_activity is 24 rows, about 1 KB.
Both are built in under a second.
"""

import argparse
import sqlite3
import sys

SCHEMA = """
DROP TABLE IF EXISTS daily_ips;
CREATE TABLE daily_ips (
  day      TEXT    NOT NULL,
  ip_id    INTEGER NOT NULL,
  sessions INTEGER NOT NULL,
  commands INTEGER NOT NULL,
  PRIMARY KEY (day, ip_id)
) WITHOUT ROWID;
INSERT INTO daily_ips
  SELECT date(started_at), ip_id, COUNT(*), COALESCE(SUM(command_count), 0)
  FROM sessions
  WHERE started_at IS NOT NULL
  GROUP BY date(started_at), ip_id;

DROP TABLE IF EXISTS hourly_activity;
CREATE TABLE hourly_activity (
  hour     INTEGER NOT NULL,
  sessions INTEGER NOT NULL,
  commands INTEGER NOT NULL,
  PRIMARY KEY (hour)
) WITHOUT ROWID;
INSERT INTO hourly_activity
  SELECT CAST(strftime('%H', started_at) AS INTEGER), COUNT(*),
         COALESCE(SUM(command_count), 0)
  FROM sessions
  WHERE started_at IS NOT NULL
  GROUP BY 1;
"""


def drift(db):
    """How far daily_ips' totals are from the table it summarises."""
    return db.execute(
        """SELECT (SELECT COALESCE(SUM(sessions), 0) FROM daily_ips)
                - (SELECT COUNT(*) FROM sessions WHERE started_at IS NOT NULL),
                  (SELECT COALESCE(SUM(commands), 0) FROM daily_ips)
                - (SELECT COALESCE(SUM(command_count), 0) FROM sessions WHERE started_at IS NOT NULL)"""
    ).fetchone()


def hourly_drift(db):
    """The same check for hourly_activity, which sums the same two columns."""
    return db.execute(
        """SELECT (SELECT COALESCE(SUM(sessions), 0) FROM hourly_activity)
                - (SELECT COUNT(*) FROM sessions WHERE started_at IS NOT NULL),
                  (SELECT COALESCE(SUM(commands), 0) FROM hourly_activity)
                - (SELECT COALESCE(SUM(command_count), 0) FROM sessions WHERE started_at IS NOT NULL)"""
    ).fetchone()


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("path", help="the assembled honeypot.db, before sharding")
    parser.add_argument(
        "--check",
        action="store_true",
        help="report whether the rollup is present and current, without writing",
    )
    args = parser.parse_args()

    db = sqlite3.connect(args.path)

    if args.check:
        present = db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='daily_ips'"
        ).fetchone()[0]
        if not present:
            print("build-rollups: daily_ips MISSING", file=sys.stderr)
            return 1
        hourly = db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='hourly_activity'"
        ).fetchone()[0]
        if not hourly:
            print("build-rollups: hourly_activity MISSING", file=sys.stderr)
            return 1
        rows = db.execute("SELECT COUNT(*) FROM daily_ips").fetchone()[0]
        hours = db.execute("SELECT COUNT(*) FROM hourly_activity").fetchone()[0]
        # Present is not the same as current. A rollup left over from an
        # earlier build would be silently stale, and the dashboard would show
        # confident wrong numbers, so --check verifies the totals too.
        off = drift(db)
        if off != (0, 0):
            print(
                f"build-rollups: daily_ips present but STALE — totals off by {off}",
                file=sys.stderr,
            )
            return 1
        hoff = hourly_drift(db)
        if hoff != (0, 0):
            print(
                f"build-rollups: hourly_activity present but STALE — totals off by {hoff}",
                file=sys.stderr,
            )
            return 1
        print(
            f"build-rollups: daily_ips present and current, {rows:,} rows; "
            f"hourly_activity {hours} hours",
            file=sys.stderr,
        )
        return 0

    db.executescript(SCHEMA)
    db.commit()

    rows = db.execute("SELECT COUNT(*) FROM daily_ips").fetchone()[0]
    days = db.execute("SELECT COUNT(DISTINCT day) FROM daily_ips").fetchone()[0]
    hours = db.execute("SELECT COUNT(*) FROM hourly_activity").fetchone()[0]

    # The rollup must agree with the table it summarises, or it is worse than
    # useless - the dashboard would show confident wrong numbers. Cheap to
    # check here, where both are in one file.
    for name, off in (("daily_ips", drift(db)), ("hourly_activity", hourly_drift(db))):
        if off != (0, 0):
            print(
                f"build-rollups: {name} disagrees with sessions by {off} — NOT safe to publish",
                file=sys.stderr,
            )
            return 1

    print(
        f"build-rollups: daily_ips rebuilt — {rows:,} rows across {days} days; "
        f"hourly_activity rebuilt — {hours} hours; all totals agree",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
