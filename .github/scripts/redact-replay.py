#!/usr/bin/env python3
"""Strip the honeypot's own identity out of session_replay.json before publishing.

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
import json
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


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("path", help="session_replay.json, or - for stdin")
    parser.add_argument("-o", "--output", help="write here instead of in place")
    parser.add_argument(
        "--check",
        action="store_true",
        help="report what would change and exit 1 if anything would, without writing",
    )
    args = parser.parse_args()

    if args.path == "-":
        replay = json.load(sys.stdin)
    else:
        with open(args.path, encoding="utf-8") as handle:
            replay = json.load(handle)

    edits = redact_replay(replay)

    if args.check:
        print(f"redact-replay: {edits} event(s) would be redacted", file=sys.stderr)
        return 1 if edits else 0

    if args.output == "-" or (args.path == "-" and not args.output):
        json.dump(replay, sys.stdout, separators=(",", ":"))
    else:
        target = args.output or args.path
        with open(target, "w", encoding="utf-8") as handle:
            json.dump(replay, handle, separators=(",", ":"))
        print(f"redact-replay: redacted {edits} event(s) in {target}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
