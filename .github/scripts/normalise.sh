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

if [ "$needs_work" = 1 ]; then
  echo "Database needs the index or the rollups; rebuilding."
  python3 "$S/index-db.py" "$TMP/honeypot.db"
  python3 "$S/build-rollups.py" "$TMP/honeypot.db"
  python3 "$S/shard-db.py" split "$DATA/db" "$TMP/honeypot.db"
else
  echo "Database already has the index and current rollups; leaving the shards alone."
fi
