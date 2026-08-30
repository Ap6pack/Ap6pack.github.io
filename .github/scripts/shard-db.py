#!/usr/bin/env python3
"""Assemble the sharded database into one file, or split one back into shards.

The dashboard reads honeypot.db through sql.js-httpvfs in "chunked" mode: the
database is published as fixed-size shards plus a config.json describing them,
and the browser fetches byte ranges out of individual shards. index-db.py and
build-rollups.py both need the whole file, so anything that runs them against a
published export has to join the shards first and split them again after.

    shard-db.py join  DATADIR OUT.db     # shards      -> one file
    shard-db.py split DATADIR IN.db      # one file    -> shards, config updated

Both directions verify the round trip by hash. `split` removes shards left over
from a previous, longer database, which matters because the file only ever
grows: leaving an orphaned tail shard behind would not corrupt anything the
browser reads, but it would sit in the repository forever.
"""

import argparse
import datetime
import glob
import hashlib
import json
import math
import os
import sys


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def shard_paths(dbdir, cfg):
    return sorted(glob.glob(os.path.join(dbdir, cfg["urlPrefix"] + "*")))


def join(dbdir, out):
    cfg = json.load(open(os.path.join(dbdir, "config.json")))
    parts = shard_paths(dbdir, cfg)
    with open(out, "wb") as fh:
        for part in parts:
            fh.write(open(part, "rb").read())

    size = os.path.getsize(out)
    stated = cfg["databaseLengthBytes"]
    if size != stated:
        print(
            f"shard-db: joined {size:,} bytes but config.json says {stated:,} — "
            "the published shards and their config disagree",
            file=sys.stderr,
        )
        return 1
    print(f"shard-db: joined {len(parts)} shards into {size:,} bytes", file=sys.stderr)
    return 0


def split(dbdir, src):
    cfg = json.load(open(os.path.join(dbdir, "config.json")))
    chunk = cfg["serverChunkSize"]
    width = cfg["suffixLength"]
    prefix = cfg["urlPrefix"]

    size = os.path.getsize(src)
    count = math.ceil(size / chunk)
    if count >= 10 ** width:
        print(
            f"shard-db: {count} shards will not fit in a {width}-digit suffix",
            file=sys.stderr,
        )
        return 1

    for stale in shard_paths(dbdir, cfg):
        os.remove(stale)

    with open(src, "rb") as fh:
        for i in range(count):
            name = os.path.join(dbdir, f"{prefix}{i:0{width}d}")
            open(name, "wb").write(fh.read(chunk))

    cfg["databaseLengthBytes"] = size
    cfg["generatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with open(os.path.join(dbdir, "config.json"), "w") as fh:
        json.dump(cfg, fh, indent=2)
        fh.write("\n")

    # A database the browser cannot reassemble is worse than one that was never
    # rebuilt, and this is the last point at which both forms exist.
    rejoined = hashlib.sha256()
    for i in range(count):
        rejoined.update(open(os.path.join(dbdir, f"{prefix}{i:0{width}d}"), "rb").read())
    if rejoined.hexdigest() != digest(src):
        print("shard-db: shards do not reassemble to the source — NOT safe to publish", file=sys.stderr)
        return 1

    print(f"shard-db: split {size:,} bytes into {count} shards, round trip verified", file=sys.stderr)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("mode", choices=("join", "split"))
    parser.add_argument("datadir", help="the directory holding config.json and the shards")
    parser.add_argument("dbfile", help="the single-file database to write (join) or read (split)")
    args = parser.parse_args()
    return join(args.datadir, args.dbfile) if args.mode == "join" else split(args.datadir, args.dbfile)


if __name__ == "__main__":
    sys.exit(main())
