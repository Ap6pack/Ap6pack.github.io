#!/usr/bin/env python3
"""Give every manifest entry a type and a scan state, and make the counts agree.

RUNS ON THE BOX, NOT IN THE BUILD
---------------------------------

Like redact-replay.py, index-db.py and build-rollups.py, this belongs to the
export pipeline on the honeypot machine. It runs last, over the exporter's
finished output rather than over the database:

    normalize-samples.py path/to/data          # rewrites manifest.json + stats.json
    normalize-samples.py path/to/data --check  # reports, writes nothing

Idempotent: running it on an already-normalised manifest changes nothing.

THREE NUMBERS FOR ONE THING
---------------------------

Today the published export answers "how many samples were captured" three
different ways:

    stats.json    files_captured: 9
    manifest.json 46 entries
    dashboard     8 real captures behind 38 empty download records

None of them is a lie, exactly. They are three different definitions of
"captured sample" applied in three places, and no file says which one is meant.
The dashboard reached agreement with itself by re-deriving the count on both
pages that show it, which fixed the contradiction on screen but left the
underlying disagreement in the data.

This puts the definition in one place. Every entry gets a `kind`:

    file      a stored file worth calling a capture     8 entries
    fragment  a real hash, but under 32 bytes           5 entries
    redirect  Cowrie logged a download, nothing stored  33 entries

and `stats.files_captured` is rewritten to the number of `file` entries, so the
tile and the table cannot drift apart again. Anything consuming the manifest
reads `kind` instead of re-implementing the rule from `size` and a hash prefix.

THE HASH FIELD THAT DOES NOT HOLD A HASH
----------------------------------------

33 of the 46 entries carry `"sha256": "redir_05bade38…"` — a UUID in a field
typed as a digest. Cowrie records a download entry when a transfer resolved to
a redirect and nothing was stored, and the exporter gives it a pseudo-hash so
it has a primary key. The dashboard filters them out by matching the `redir_`
prefix, which works and is also exactly the kind of rule that breaks silently
the day the prefix changes.

Normalised, a redirect artefact carries its identifier in `id` and has no
`sha256` at all. The field either holds a digest or is absent.

SCANNED, UNSCANNED, AND UNSCANNABLE
-----------------------------------

34 of 46 entries have no VirusTotal fields, and the page said "not yet scanned"
for all of them — which reads as "queued, check back later". For a redirect
artefact there is nothing to scan and never will be. For the 950 KB binary at
306f0c79, nothing is queued either; no scan was ever recorded, and the row
would have said "not yet scanned" indefinitely.

So `scan` is stated rather than inferred from the absence of a field:

    scanned          a VirusTotal verdict is present            12
    failed           the exporter recorded an error              0
    pending          the exporter recorded a queued attempt      0
    never_attempted  no scan and no attempt on record            1
    not_applicable   nothing was stored, so nothing to scan     33

`failed` and `pending` are read from `vt_error` and `vt_queued_at` if the
exporter ever writes them; until it does they are simply empty, and the
distinction the dashboard needs — "we tried and it did not work" against "we
never tried" — is at least expressible instead of collapsed into one phrase.
"""

import argparse
import json
import os
import re
import sys

SHA256 = re.compile(r"^[0-9a-f]{64}$")

# Below this an entry is a few bytes a probe echoed back, not a payload. The
# same threshold the dashboard used to apply on its own; it lives here now.
FRAGMENT_SIZE = 32


def classify(entry):
    """kind, and the identifier that belongs in a digest field (or None)."""
    digest = entry.get("sha256") or ""
    if SHA256.match(digest):
        return ("file" if entry.get("size", 0) >= FRAGMENT_SIZE else "fragment"), digest
    return "redirect", None


def scan_state(entry, kind):
    if kind == "redirect":
        return "not_applicable"
    if entry.get("vt_total") is not None:
        return "scanned"
    if entry.get("vt_error"):
        return "failed"
    if entry.get("vt_queued_at"):
        return "pending"
    return "never_attempted"


def normalize(entry):
    kind, digest = classify(entry)

    out = {"kind": kind}
    if digest:
        out["sha256"] = digest
    else:
        # Keep the identifier, just not in a field that claims to be a hash.
        # Already-normalised records carry it in `id`; raw ones have it stuffed
        # into `sha256` behind a `redir_` prefix.
        held = entry.get("id") or entry.get("sha256") or ""
        out["id"] = held[len("redir_"):] if held.startswith("redir_") else held

    out["size"] = entry.get("size", 0)
    # Verbatim. These name real files on disk, prefix and all.
    out["zip"] = entry.get("zip")
    out["scan"] = scan_state(entry, kind)

    for field in ("vt_positives", "vt_total", "vt_permalink", "vt_error", "vt_queued_at"):
        if entry.get(field) is not None:
            out[field] = entry[field]

    return out


def counts(entries):
    tally = {"file": 0, "fragment": 0, "redirect": 0}
    for entry in entries:
        tally[entry["kind"]] = tally.get(entry["kind"], 0) + 1
    return tally


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("data", help="the exporter's output directory, holding manifest.json")
    parser.add_argument(
        "--check",
        action="store_true",
        help="report what normalising would change, and exit 1 if anything, without writing",
    )
    args = parser.parse_args()

    manifest_path = os.path.join(args.data, "manifest.json")
    stats_path = os.path.join(args.data, "stats.json")

    with open(manifest_path) as fh:
        raw = json.load(fh)
    if not isinstance(raw, list):
        print(f"normalize-samples: {manifest_path} is not a list of entries", file=sys.stderr)
        return 1

    entries = [normalize(entry) for entry in raw]
    tally = counts(entries)
    captured = tally["file"]

    stats = None
    if os.path.exists(stats_path):
        with open(stats_path) as fh:
            stats = json.load(fh)

    manifest_changed = entries != raw
    stats_changed = stats is not None and stats.get("files_captured") != captured

    summary = (
        f"{tally['file']} file, {tally['fragment']} fragment, {tally['redirect']} redirect"
    )
    scans = {}
    for entry in entries:
        scans[entry["scan"]] = scans.get(entry["scan"], 0) + 1
    scan_summary = ", ".join(f"{n} {state}" for state, n in sorted(scans.items()))

    if args.check:
        print(f"normalize-samples: {len(entries)} entries — {summary}", file=sys.stderr)
        print(f"normalize-samples: scans — {scan_summary}", file=sys.stderr)
        if stats is not None:
            print(
                f"normalize-samples: stats.files_captured is {stats.get('files_captured')!r}, "
                f"manifest says {captured}",
                file=sys.stderr,
            )
        if not manifest_changed and not stats_changed:
            print("normalize-samples: already normalised, nothing to do", file=sys.stderr)
            return 0
        what = []
        if manifest_changed:
            what.append("manifest.json")
        if stats_changed:
            what.append("stats.json")
        print(f"normalize-samples: would rewrite {' and '.join(what)}", file=sys.stderr)
        return 1

    if not manifest_changed and not stats_changed:
        print("normalize-samples: already normalised, nothing to do", file=sys.stderr)
        return 0

    # Write through a temporary file. The exporter's output is served straight
    # from this directory, so a half-written manifest is a broken page rather
    # than a failed build.
    if manifest_changed:
        tmp = manifest_path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(entries, fh, indent=2)
            fh.write("\n")
        os.replace(tmp, manifest_path)
        print(f"normalize-samples: manifest.json rewritten — {summary}", file=sys.stderr)

    if stats_changed:
        was = stats.get("files_captured")
        stats["files_captured"] = captured
        tmp = stats_path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(stats, fh, indent=2)
            fh.write("\n")
        os.replace(tmp, stats_path)
        print(
            f"normalize-samples: stats.files_captured {was} -> {captured}, from the manifest",
            file=sys.stderr,
        )

    print(f"normalize-samples: scans — {scan_summary}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
