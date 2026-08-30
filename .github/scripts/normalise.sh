#!/bin/sh
# Apply the export-pipeline transformations to dist/honeypot/data in place.
#
# Written to be re-entrant: it can be run again on a different checkout of the
# same tree without any cleanup in between, which is what makes the push-retry
# loop in the workflow correct. If the remote moves under us we reset onto the
# new tip and simply run this again.
#
# Every step is idempotent, so running it on an already-normalised tree changes
# nothing and leaves the working tree clean.
set -eu

DATA="dist/honeypot/data"
TMP="${RUNNER_TEMP:-/tmp}"
S=".github/scripts"

python3 "$S/normalize-samples.py" "$DATA"
python3 "$S/redact-replay.py" "$DATA"

# The database is only rewritten when it actually needs it.
#
# build-rollups.py DROPs and rebuilds its tables, and shard-db.py stamps a fresh
# generatedAt into config.json, so running them unconditionally produces a diff
# on every sync that touches the database even when the content is identical.
# That is pure noise in a repository that already carries an 85 MB database, so
# ask first.
python3 "$S/shard-db.py" join "$DATA/db" "$TMP/honeypot.db"

needs_work=0
python3 "$S/index-db.py" "$TMP/honeypot.db" --check || needs_work=1
python3 "$S/build-rollups.py" "$TMP/honeypot.db" --check || needs_work=1

# stats.json describes the whole capture; the shipped database is a pruned
# subset of it. Recording the difference keeps every clickable figure equal to
# the rows behind it. Needs the joined database, so it runs after the join.
python3 "$S/reconcile-stats.py" "$DATA" --db "$TMP/honeypot.db"

if [ "$needs_work" = 1 ]; then
  echo "Database needs the index or the rollups; rebuilding."
  python3 "$S/index-db.py" "$TMP/honeypot.db"
  python3 "$S/build-rollups.py" "$TMP/honeypot.db"
  python3 "$S/shard-db.py" split "$DATA/db" "$TMP/honeypot.db"
else
  echo "Database already has the index and current rollups; leaving the shards alone."
fi

# Separate reconnaissance from attack, and record the source-weighted counts.
#
# One probe from five addresses carries 79.8% of every session here, so every
# session- and event-weighted total describes those five hosts rather than the
# internet. This writes the split into stats.json and classification.json;
# nothing is filtered.
python3 "$S/classify-traffic.py" "$DATA" --db "$TMP/honeypot.db"

# The published feed: data/v1/, tiered and aged, plus MISP and STIX.
#
# Runs last because it reads what everything above wrote - the reconciled
# stats, the recon classification, and the joined database. Rewrites a file
# only when something other than the clock moved, so a sync that changed
# nothing leaves all 68 of them alone.
python3 "$S/build-feed.py" "$DATA" --db "$TMP/honeypot.db"
