#!/usr/bin/env python3
"""Publish the observations as something a machine can consume and act on.

    build-feed.py DATADIR --db DB           # write data/v1/
    build-feed.py DATADIR --db DB --check   # report, write nothing

WHY A TIERED FEED AND NOT A LIST

A flat list of every address this honeypot has seen would be actively harmful
as a blocklist. Measured 2026-08-30 over 2,254 observed addresses:

    delivered a payload      149    6.6%
    ran any command          662   29.4%
    persistent (>5 sessions) 128    5.7%
    seen exactly once      1,253   55.6%

More than half were seen once, many on residential ranges that belong to
compromised home routers with dynamic addresses. Ship that as a blocklist and
consumers block addresses that have since been reassigned to somebody who was
never involved. The tiers exist so a consumer can choose their own false
positive rate instead of inheriting ours, and the README defines them
precisely enough to disagree with.

AGING IS NOT OPTIONAL

Every indicator carries `first_seen`, `last_seen` and `ttl_days`. An
observation is not a verdict, and an address that has not been seen for a
fortnight is not evidence of anything today. Recency is measured against the
dataset's own generation time, not against the newest row in it: an export
that stops updating must produce a feed that ages out, not one that stays
permanently fresh because its own contents define "now".

RECON IS EXCLUDED FROM THE CONFIDENT TIERS

An address whose entire history is `echo -e "\\x6F\\x6B"` - one command, two
seconds, no payload - is scanning for honeypots, not attacking anything. It is
published, with `recon_only: true`, and kept out of high-confidence. See
scripts/classify-traffic.py for the classification.

WHAT IS DELIBERATELY NOT VERSIONED HERE

data/v1/ carries the documents a third party would automate against. geo.json
(904 KB) is the map's rendering data and duplicates nothing a consumer needs -
indicators.json already carries country and network. kev.json (314 KB) is a
copy of CISA's catalogue and should be fetched from CISA. Both stay at the
unversioned path, and CHANGELOG.md says so. Copying 1.2 MB into a second path
on every one of 48 daily syncs would be repo churn bought with nothing.
"""

import argparse
import csv
import datetime as dt
import io
import json
import os
import re
import sqlite3
import sys
import uuid

SCHEMA_VERSION = "1.0"
FEED_VERSION = "v1"

# How long an observation stays actionable. Seven days is the window the
# confident tiers use, and it is stated on every record so a consumer who
# disagrees can re-derive the tiers from indicators.json themselves.
TTL_DAYS = 7

# The documents that make up the versioned contract. Everything else stays at
# the unversioned path - see the module docstring.
VERSIONED = [
    "stats.json",
    "attack_techniques.json",
    "manifest.json",
    "llm_fallback.json",
    "classification.json",
]


def parse_ts(value):
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def iso(value):
    """Normalise whatever the exporter wrote into one ISO-8601 UTC spelling."""
    ts = parse_ts(value)
    if ts is None:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=dt.timezone.utc)
    return ts.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def campaigns_by_ip(db):
    """The behaviour cluster each address is most associated with.

    Most-frequent rather than most-recent: an address that ran one campaign 40
    times and another once is characterised by the first. Ties break on the
    signature so the output is stable between runs.
    """
    rows = db.execute(
        """
        SELECT ip_id, cluster_signature, COUNT(*) n
          FROM sessions
         WHERE cluster_signature IS NOT NULL
         GROUP BY ip_id, cluster_signature
        """
    ).fetchall()
    best = {}
    for r in rows:
        cur = best.get(r["ip_id"])
        key = (r["n"], r["cluster_signature"])
        if cur is None or key > cur[0]:
            best[r["ip_id"]] = (key, r["cluster_signature"])
    return {k: v[1] for k, v in best.items()}


def recon_only_ips(db, recon_signatures):
    """Addresses whose every clustered session is reconnaissance.

    "Every" matters. An address that runs the detection probe and then comes
    back to install something is not a recon host, and a rule keyed on "ran the
    probe at all" would drop it out of the confident tiers - which is precisely
    backwards.
    """
    if not recon_signatures:
        return set()
    marks = ",".join("?" * len(recon_signatures))
    rows = db.execute(
        f"""
        SELECT ip_id,
               SUM(CASE WHEN cluster_signature IN ({marks}) THEN 1 ELSE 0 END) recon,
               COUNT(*) total
          FROM sessions
         WHERE cluster_signature IS NOT NULL
         GROUP BY ip_id
        HAVING recon = total
        """,
        recon_signatures,
    ).fetchall()
    return {r["ip_id"] for r in rows}


def tier(row, fresh, recon_only):
    """(confidence, tier_reason) for one address.

    Ordered by strength of evidence, most specific first. `recon_only` never
    reaches high: the whole point of separating it is that running a detection
    probe is not evidence of an attack.
    """
    if row["download_count"] > 0 and fresh and not recon_only:
        return "high", "delivered_payload"
    if row["command_count"] > 0 and fresh and not recon_only:
        return "medium", "executed_commands"
    if row["session_count"] > 5 and not recon_only:
        return "medium", "persistent"
    if row["download_count"] > 0 or row["command_count"] > 0:
        # Real evidence, but stale, or recon. Still worth publishing; not worth
        # blocking on.
        return "low", "delivered_payload" if row["download_count"] > 0 else "executed_commands"
    if row["session_count"] <= 1:
        return "low", "single_sighting"
    return "low", "connected_only"


def build_indicators(db, generated_at, recon_signatures):
    camp = campaigns_by_ip(db)
    recon_ips = recon_only_ips(db, recon_signatures)
    cutoff = generated_at - dt.timedelta(days=TTL_DAYS)

    out = []
    for r in db.execute(
        """
        SELECT id, ip, first_seen, last_seen, country, isp, domain, is_tor,
               abuse_score, session_count, login_count, command_count, download_count
          FROM ips ORDER BY ip
        """
    ):
        last = parse_ts(r["last_seen"])
        if last is not None and last.tzinfo is None:
            last = last.replace(tzinfo=dt.timezone.utc)
        fresh = last is not None and last >= cutoff
        only_recon = r["id"] in recon_ips
        confidence, reason = tier(r, fresh, only_recon)
        out.append(
            {
                "schema_version": SCHEMA_VERSION,
                "ip": r["ip"],
                "first_seen": iso(r["first_seen"]),
                "last_seen": iso(r["last_seen"]),
                "sessions": r["session_count"],
                "logins": r["login_count"],
                "commands": r["command_count"],
                "downloads": r["download_count"],
                "confidence": confidence,
                "tier_reason": reason,
                "recon_only": only_recon,
                "active_within_ttl": fresh,
                "campaign": camp.get(r["id"]),
                "ttl_days": TTL_DAYS,
                "country": r["country"] or None,
                "asn_org": r["isp"] or None,
                "domain": r["domain"] or None,
                "is_tor": bool(r["is_tor"]),
                "abuse_score": r["abuse_score"],
            }
        )
    return out


def plain_list(indicators, predicate, title, generated_at, note):
    """One IP per line with a `#` header, which is what blocklist tools read."""
    picked = [i["ip"] for i in indicators if predicate(i)]
    lines = [
        f"# {title}",
        f"# generated: {generated_at.isoformat().replace('+00:00', 'Z')}",
        f"# indicators: {len(picked)}",
        f"# ttl_days: {TTL_DAYS} - re-fetch at least this often; entries expire",
        "#",
        *(f"# {n}" for n in note),
        "#",
        "# Presence means traffic reached a honeypot from this address. It does",
        "# not mean the address's owner did anything wrong - many are",
        "# compromised third parties. See README.md before acting on this file.",
        "",
    ]
    return "\n".join(lines + picked) + ("\n" if picked else "")


def csv_value(v):
    """Booleans as JSON spells them.

    csv.DictWriter renders Python bools as `True`/`False`, which a SIEM
    importing this alongside indicators.json has to special-case. The two files
    are meant to be the same data in two shapes, so they agree on how a boolean
    looks.
    """
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    return v


def to_csv(indicators):
    if not indicators:
        return ""
    cols = [k for k in indicators[0] if k != "schema_version"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, lineterminator="\n", extrasaction="ignore")
    w.writeheader()
    for row in indicators:
        w.writerow({k: csv_value(row[k]) for k in cols})
    return buf.getvalue()



def feed_readme(counts, generated_at, rule):
    """The methodology. A tier a consumer cannot re-derive is a tier they have
    to take on trust, which is the thing this feed is trying not to ask for."""
    stamp = generated_at.isoformat().replace("+00:00", "Z")
    secs = (rule or {}).get("max_avg_duration_ms", 5000) / 1000
    return f"""# Sundew honeypot indicator feed

Generated {stamp} from a single Cowrie SSH/Telnet honeypot on one AWS EC2
instance. Schema `{SCHEMA_VERSION}`, feed `{FEED_VERSION}`. Licence: CC BY 4.0.

## Read this before you block anything

**Presence in this feed means traffic reached a honeypot from that address. It
does not mean the address's owner did anything wrong.** A large share of what
arrives at any honeypot comes from compromised third parties - home routers,
IP cameras, small business servers - whose owners have no idea. Many sit on
residential ranges with dynamic addresses, so the address that attacked
yesterday may belong to somebody uninvolved today.

That is why every indicator carries `last_seen` and `ttl_days`, and why more
than half of what this honeypot has seen is deliberately kept out of the
confident tiers. Of {counts['total']:,} observed addresses,
{counts['seen_once']:,} were seen exactly once - {counts['seen_once'] * 100 // counts['total']}% of the feed.

**Removal.** If your address is listed and you believe it should not be, open
an issue at <https://github.com/Ap6pack/Ap6pack.github.io/issues> or email the
contact in `/.well-known/security.txt`. Include the address and a rough time
window. Removal requests are honoured; there is no appeal process to exhaust.

## Files

| File | What it is |
|---|---|
| `high-confidence.txt` | Delivered a payload **and** seen within {TTL_DAYS} days. Plain text, one address per line, `#` comments. Drop-in for blocklist tooling. |
| `active.txt` | Ran at least one command **and** seen within {TTL_DAYS} days. Broader, noisier. |
| `indicators.json` | Every observed address with its full record. The authoritative file. |
| `indicators.csv` | The same content, flat, for SIEM and spreadsheet import. |
| `campaigns.json` | Behaviour clusters: what each campaign runs, who runs it, and a terminal recording. |
| `misp/` | MISP feed. Subscribe to the directory URL directly. |
| `stix2.json` | STIX 2.1 bundle. |

## Tiers, precisely

Recency is measured against this dataset's **generation time**, not against its
newest row. An export that stops updating produces a feed that ages out rather
than one that stays permanently fresh because its own contents define "now".

```
fresh          := last_seen >= generated_at - {TTL_DAYS} days
recon_only     := every clustered session this address ran was reconnaissance

high           := downloads > 0  AND fresh  AND NOT recon_only
medium         := commands  > 0  AND fresh  AND NOT recon_only
                  OR sessions > 5 AND NOT recon_only
low            := everything else
```

`tier_reason` says which clause fired: `delivered_payload`,
`executed_commands`, `persistent`, `single_sighting`, `connected_only`.

Current distribution:

| Confidence | Addresses |
|---|---|
| high | {counts['high']:,} |
| medium | {counts['medium']:,} |
| low | {counts['low']:,} |
| **total** | **{counts['total']:,}** |

Every field the tiers are derived from is in `indicators.json`. If you disagree
with where the lines are drawn - and you may well, they are one operator's
judgement - re-derive your own from that file. Nothing here is hidden behind
the tiering.

## Reconnaissance is separated, not deleted

One behaviour cluster on this sensor runs `echo -e "\\x6F\\x6B"` - which prints
`ok` - to test whether the shell is real, then disconnects after about two
seconds. It accounts for around 80% of all sessions from five addresses.

A cluster is classified as reconnaissance when **all** of: one command per
session, average duration under {secs}s, and no downloads from any of its
sessions. Addresses whose every clustered session is reconnaissance carry
`recon_only: true` and are excluded from `high` and `medium` by construction -
scanning for honeypots is not evidence of an attack. They stay in
`indicators.json`, because a sweep at that scale is worth knowing about.

{counts['recon_only']:,} addresses are currently `recon_only`.

## What this is not

- **Not a threat feed with global coverage.** One sensor, one address, a few
  weeks. It sees what happens to walk past.
- **Not a reputation service.** No scoring model, no enrichment beyond what is
  in the record.
- **Not a verdict.** Every entry is an observation with a timestamp and an
  expiry. Treat it as one.
- **Not deduplicated against other feeds.** Overlap with commercial and
  community lists is expected and unmeasured.

## What `generated_at` means here

**When these observations were last different, not when the generator last
ran.** The export regenerates every 30 minutes and the database behind it
republishes twice a day, so stamping a fresh time onto 3.3 MB of unchanged
files 48 times a day would be churn with no information in it. A file is
rewritten only when something other than the clock moved.

In practice `generated_at` advances whenever anything you would act on
changed - including an indicator ageing past its TTL, which counts as news. If
you need "when was this last checked" rather than "when did this last change",
use the HTTP `Last-Modified` header or `../stats.json`, whose `generated_at` is
the export clock.

## Stability

Breaking changes get a new version path (`v2/`), and the previous version stays
live for at least 90 days. Additive changes - a new optional field - happen in
place and are recorded in `../CHANGELOG.md`. Every document carries
`schema_version`.
"""



def build_campaigns(db, data_dir, recon_signatures, generated_at):
    """Per-campaign behaviour, so an indicator can be looked up and understood.

    This is the part no free feed offers: take an address out of
    indicators.json, read its `campaign`, and find here what it actually ran,
    which other addresses ran the same thing, and a terminal recording of it.

    Two counts, because they answer different questions and pruning makes them
    differ. `sessions` and `source_addresses` are capture-wide, from the
    clustering. `published_sessions` and `published_addresses` are what the
    shipped database can show you. Quoting the first while linking the second
    is the defect this project keeps finding in itself, so both are stated.
    """
    recon = set(recon_signatures)
    replays = {
        r["session_id"]: r["duration"]
        for r in db.execute("SELECT session_id, duration FROM session_replays")
    }
    have_cast = set()
    replay_dir = os.path.join(data_dir, "replays")
    if os.path.isdir(replay_dir):
        have_cast = {n[:-5] for n in os.listdir(replay_dir) if n.endswith(".cast")}

    published = {
        r["sig"]: (r["n"], r["ips"])
        for r in db.execute(
            """SELECT cluster_signature sig, COUNT(*) n, COUNT(DISTINCT ip_id) ips
                 FROM sessions WHERE cluster_signature IS NOT NULL GROUP BY sig"""
        )
    }

    out = []
    for c in db.execute(
        """SELECT signature, session_count, ip_count, command_count, representative,
                  first_seen, last_seen FROM behavior_clusters ORDER BY ip_count DESC, signature"""
    ):
        sig = c["signature"]
        commands = [
            r["text"]
            for r in db.execute(
                """SELECT cm.text FROM session_commands sc
                     JOIN commands cm ON cm.id = sc.command_id
                    WHERE sc.session_id = ? ORDER BY sc.id""",
                (c["representative"],),
            )
        ]
        addresses = [
            r["ip"]
            for r in db.execute(
                """SELECT DISTINCT i.ip FROM sessions s JOIN ips i ON i.id = s.ip_id
                    WHERE s.cluster_signature = ? ORDER BY i.ip""",
                (sig,),
            )
        ]
        pub_sessions, pub_ips = published.get(sig, (0, 0))
        rep = c["representative"]
        out.append(
            {
                "signature": sig,
                "class": "recon" if sig in recon else "attack",
                "command_sequence": commands,
                "commands_per_session": c["command_count"],
                "sessions": c["session_count"],
                "source_addresses": c["ip_count"],
                "published_sessions": pub_sessions,
                "published_addresses": pub_ips,
                "first_seen": iso(c["first_seen"]),
                "last_seen": iso(c["last_seen"]),
                "representative_session": rep,
                # Relative, so the feed works from a mirror as well as from the
                # canonical origin.
                "replay_url": f"../../replays/{rep}.cast" if rep in have_cast else None,
                "replay_duration_s": replays.get(rep),
                "dashboard_url": f"https://ap6pack.github.io/dist/honeypot/#session/{rep}",
                "addresses": addresses,
            }
        )
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at.isoformat().replace("+00:00", "Z"),
        "count": len(out),
        "note": (
            "`sessions` and `source_addresses` are capture-wide. "
            "`published_sessions` and `published_addresses` are what the shipped "
            "database holds, which is a pruned subset - so a campaign's session "
            "count is usually larger than the number of sessions you can open."
        ),
        "campaigns": out,
    }



# A fixed namespace, so every identifier this script emits is a pure function
# of what it describes. MISP and STIX consumers deduplicate on UUID: a feed
# that minted fresh ones every 30 minutes would create 48 copies of the same
# indicator a day in every subscriber's database.
NS = uuid.UUID("6f1d5e2c-9a47-5b30-8e11-0c4a7d9b2f68")

ORG = {
    "name": "Sundew honeypot",
    "uuid": str(uuid.uuid5(NS, "orgc")),
}

# MISP and STIX carry indicators to act on, not the full observation log.
# `indicators.json` keeps all 2,254 addresses; these two files carry the tiers
# a consumer would actually load into a detection pipeline. Emitting the low
# tier as well would triple both files, republish them 48 times a day, and give
# subscribers 1,808 single-sighting addresses they should not be blocking.
EXPORT_TIERS = ("high", "medium")


def det_uuid(*parts):
    return str(uuid.uuid5(NS, "|".join(str(p) for p in parts)))


def build_misp(indicators, campaigns, generated_at):
    """A MISP feed: manifest.json plus one event per campaign.

    Follows the feed layout MISP expects from a URL feed - a manifest keyed by
    event UUID, and `<uuid>.json` beside it holding `{"Event": {...}}`.
    """
    actionable = [i for i in indicators if i["confidence"] in EXPORT_TIERS]
    by_campaign = {}
    for i in actionable:
        by_campaign.setdefault(i["campaign"], []).append(i)

    camp_by_sig = {c["signature"]: c for c in campaigns["campaigns"]}
    date = generated_at.date().isoformat()
    ts = str(int(generated_at.timestamp()))

    events, manifest = {}, {}
    for sig, members in sorted(by_campaign.items(), key=lambda kv: (kv[0] is None, kv[0] or "")):
        c = camp_by_sig.get(sig)
        if sig:
            info = f"Sundew honeypot - campaign {sig[:12]} ({len(members)} sources)"
            if c and c["command_sequence"]:
                info += f" - {c['command_sequence'][0][:60]}"
        else:
            info = f"Sundew honeypot - unattributed indicators ({len(members)} sources)"
        ev_uuid = det_uuid("misp-event", sig or "unattributed")

        attributes = []
        for i in members:
            attributes.append(
                {
                    "uuid": det_uuid("misp-attr", sig or "unattributed", i["ip"]),
                    "type": "ip-src",
                    "category": "Network activity",
                    # to_ids only on the tier that says "block this". The medium
                    # tier is context; shipping it as a detection rule is how a
                    # feed earns a reputation for false positives.
                    "to_ids": i["confidence"] == "high",
                    "value": i["ip"],
                    "timestamp": ts,
                    "comment": (
                        f"{i['tier_reason']}, confidence {i['confidence']}; "
                        f"{i['sessions']} sessions, {i['commands']} commands, "
                        f"{i['downloads']} downloads; "
                        f"first_seen {i['first_seen']}, last_seen {i['last_seen']}; "
                        f"expires {TTL_DAYS}d after last_seen"
                    ),
                }
            )
        if c:
            # Deduplicated, order preserved. A campaign's command *sequence* can
            # repeat a command - one here runs `/bin/busybox YM58GUjK` three
            # times - and the attribute UUID is a function of the text, so the
            # repeats collided and MISP's schema rejected the event on
            # `uniqueItems`. The ordered sequence is what campaigns.json is
            # for; a MISP event's Attribute list is a set of artefacts.
            seen_cmds = set()
            for cmd in c["command_sequence"]:
                if cmd in seen_cmds:
                    continue
                seen_cmds.add(cmd)
                if len(seen_cmds) > 20:
                    break
                attributes.append(
                    {
                        "uuid": det_uuid("misp-cmd", sig, cmd),
                        "type": "text",
                        "category": "Artifacts dropped",
                        "to_ids": False,
                        "value": cmd,
                        "timestamp": ts,
                        "comment": "command run by this campaign",
                    }
                )

        event = {
            "uuid": ev_uuid,
            "info": info,
            "date": date,
            "analysis": "2",
            "threat_level_id": "3" if sig else "4",
            "published": True,
            "Orgc": ORG,
            "Tag": [
                {"name": 'type:OSINT'},
                {"name": 'tlp:clear'},
                {"name": f'sundew:class="{c["class"] if c else "unclassified"}"'},
            ],
            "Attribute": attributes,
        }
        events[ev_uuid] = {"Event": event}
        manifest[ev_uuid] = {
            "Orgc": ORG,
            "date": date,
            "info": info,
            "analysis": "2",
            "threat_level_id": event["threat_level_id"],
            "timestamp": ts,
            "published": True,
            "uuid": ev_uuid,
        }
    return manifest, events


def build_stix(indicators, campaigns, techniques, generated_at):
    """A STIX 2.1 bundle: indicator, observed-data, attack-pattern, campaign."""
    stamp = generated_at.isoformat().replace("+00:00", "Z")
    identity_id = f"identity--{det_uuid('stix-identity')}"
    objects = [
        {
            "type": "identity",
            "spec_version": "2.1",
            "id": identity_id,
            "created": "2026-08-16T00:00:00.000Z",
            "modified": "2026-08-16T00:00:00.000Z",
            "name": "Sundew honeypot",
            "identity_class": "system",
            "description": "A single Cowrie SSH/Telnet honeypot on one AWS EC2 instance.",
        }
    ]

    camp_ids = {}
    camp_by_sig = {c["signature"]: c for c in campaigns["campaigns"]}
    for c in campaigns["campaigns"]:
        if c["source_addresses"] < 2:
            # A "campaign" of one address is a session, not a campaign.
            continue
        cid = f"campaign--{det_uuid('stix-campaign', c['signature'])}"
        camp_ids[c["signature"]] = cid
        objects.append(
            {
                "type": "campaign",
                "spec_version": "2.1",
                "id": cid,
                "created_by_ref": identity_id,
                "created": c["first_seen"] or stamp,
                "modified": stamp,
                "name": f"sundew-{c['signature'][:12]}",
                "description": "Command sequence: " + " ; ".join(c["command_sequence"][:12]),
                "first_seen": c["first_seen"],
                "last_seen": c["last_seen"],
                "labels": [c["class"]],
            }
        )

    for t in techniques:
        objects.append(
            {
                "type": "attack-pattern",
                "spec_version": "2.1",
                "id": f"attack-pattern--{det_uuid('stix-attack-pattern', t['id'])}",
                "created_by_ref": identity_id,
                "created": "2026-08-16T00:00:00.000Z",
                "modified": stamp,
                "name": t.get("name") or t["id"],
                "external_references": [
                    {
                        "source_name": "mitre-attack",
                        "external_id": t["id"],
                        "url": t.get("url") or f"https://attack.mitre.org/techniques/{t['id']}/",
                    }
                ],
            }
        )

    for i in indicators:
        if i["confidence"] not in EXPORT_TIERS:
            continue
        ind_id = f"indicator--{det_uuid('stix-indicator', i['ip'])}"
        # valid_until is last_seen + ttl, not generated_at + ttl: the expiry
        # belongs to the observation, so a stale indicator in a fresh bundle is
        # already expired rather than silently renewed on every republish.
        last = parse_ts(i["last_seen"])
        valid_until = None
        if last is not None:
            if last.tzinfo is None:
                last = last.replace(tzinfo=dt.timezone.utc)
            valid_until = (
                (last + dt.timedelta(days=TTL_DAYS))
                .astimezone(dt.timezone.utc)
                .isoformat()
                .replace("+00:00", "Z")
            )
        indicator = {
            "type": "indicator",
            "spec_version": "2.1",
            "id": ind_id,
            "created_by_ref": identity_id,
            "created": i["first_seen"] or stamp,
            "modified": stamp,
            "name": f"Honeypot source {i['ip']}",
            "description": (
                f"{i['tier_reason']}; {i['sessions']} sessions, {i['commands']} commands, "
                f"{i['downloads']} downloads. Observation, not a verdict - see feed README."
            ),
            "indicator_types": ["malicious-activity"],
            "pattern": f"[ipv4-addr:value = '{i['ip']}']",
            "pattern_type": "stix",
            "valid_from": i["first_seen"] or stamp,
            "confidence": {"high": 85, "medium": 50}.get(i["confidence"], 15),
            "labels": [i["confidence"], i["tier_reason"]],
        }
        if valid_until:
            indicator["valid_until"] = valid_until
        objects.append(indicator)

        sco_id = f"ipv4-addr--{det_uuid('stix-ipv4', i['ip'])}"
        objects.append({"type": "ipv4-addr", "spec_version": "2.1", "id": sco_id, "value": i["ip"]})
        objects.append(
            {
                "type": "observed-data",
                "spec_version": "2.1",
                "id": f"observed-data--{det_uuid('stix-observed', i['ip'])}",
                "created_by_ref": identity_id,
                "created": stamp,
                "modified": stamp,
                "first_observed": i["first_seen"] or stamp,
                "last_observed": i["last_seen"] or stamp,
                "number_observed": max(i["sessions"], 1),
                "object_refs": [sco_id],
            }
        )
        if i["campaign"] and i["campaign"] in camp_ids:
            objects.append(
                {
                    "type": "relationship",
                    "spec_version": "2.1",
                    "id": f"relationship--{det_uuid('stix-rel', i['ip'], i['campaign'])}",
                    "created_by_ref": identity_id,
                    "created": stamp,
                    "modified": stamp,
                    "relationship_type": "indicates",
                    "source_ref": ind_id,
                    "target_ref": camp_ids[i["campaign"]],
                }
            )

    return {
        "type": "bundle",
        "id": f"bundle--{det_uuid('stix-bundle')}",
        "objects": objects,
    }


def changelog():
    """Dated entries for every schema change.

    Written by the generator rather than by hand so it cannot fall out of step
    with SCHEMA_VERSION, and appended to - never rewritten - when a version is
    added. History is the whole value of a changelog.
    """
    return """# Dataset changelog

Every schema change to the versioned dataset, newest first. Breaking changes
get a new version path; the previous version stays live for **at least 90 days**
after its successor is published.

A change is breaking if it removes a field, renames one, or changes the type or
meaning of an existing one. Adding an optional field is not breaking and happens
in place.

## v1 - 2026-08-30

Initial versioned publication.

- `v1/feed/` - tiered, aged indicator feed. `high-confidence.txt`,
  `active.txt`, `indicators.json`, `indicators.csv`, `campaigns.json`, a MISP
  feed under `misp/`, and a STIX 2.1 bundle. Methodology in `feed/README.md`.
- `schema_version` added to every document, at both the versioned and the
  unversioned path.
- `v1/stats.json`, `v1/attack_techniques.json`, `v1/manifest.json`,
  `v1/llm_fallback.json`, `v1/classification.json` - copies of the documents a
  third party would automate against.
- `stats.json` gains a `weighting` block: source-weighted counts and the
  reconnaissance split. See `classification.json` for the per-cluster detail.

### Deliberately not versioned

`geo.json` (904 KB) is the dashboard map's rendering data; `indicators.json`
already carries country and network for every address, so a consumer needs
nothing from it. `kev.json` (314 KB) is a copy of CISA's Known Exploited
Vulnerabilities catalogue and should be fetched from CISA rather than from a
mirror that updates when a honeypot happens to sync. `session_replay.json` is
a legacy artefact that nothing reads. All three stay at the unversioned path.

Copying 1.2 MB into a second path on each of 48 daily syncs would be repository
churn bought with nothing.

### Unversioned paths

`data/*.json` continues to serve the same content and is not going away. The
dashboard itself reads those paths. `data/db/` - the sharded SQLite database
read over HTTP range requests - is a bulk artefact rather than part of the JSON
schema contract, and is not duplicated under `v1/`.
"""


def version_readme(stamp):
    return f"""# Sundew dataset, {FEED_VERSION}

Data from a live Cowrie SSH/Telnet honeypot on one AWS EC2 instance, published
every 30 minutes. Last generated {stamp}.

Licence: **CC BY 4.0** (see `../LICENSE.md` for the carve-outs covering
`samples/` and `kev.json`). Attribution: <https://ap6pack.github.io/dist/honeypot/>

## Start here

- **`feed/README.md`** - the indicator feed and, more importantly, how its
  tiers are assigned and what they do not mean. Read it before acting on
  anything in this directory.
- **`CHANGELOG.md`** - every schema change, and the deprecation policy.

## Stability

Every document carries `schema_version`. Breaking changes - a removed or
renamed field, or a changed type or meaning - get a new version path (`v2/`),
and this one stays live for at least 90 days afterwards. Additive changes
happen in place and are recorded in the changelog.

## Contents

| Path | What |
|---|---|
| `feed/` | The indicator feed, campaign attribution, MISP and STIX outputs. |
| `stats.json` | Capture totals, the published subset, and the source weighting. |
| `classification.json` | Per-cluster reconnaissance/attack classification. |
| `attack_techniques.json` | MITRE ATT&CK pattern matches, with the recon split. |
| `manifest.json` | Captured malware samples and their scan state. |
| `llm_fallback.json` | Cached LLM responses for unimplemented shell commands. |

`geo.json`, `kev.json` and the sharded database under `db/` stay at the
unversioned path - see `CHANGELOG.md` for why.
"""


# Every place a generation timestamp lands. Masked on both sides of the
# comparison in write_if_changed - masking only the new stamp was the first
# attempt and did nothing, because the file on disk carries the *old* one.
#
# Each of these is safe to blank because no real observation is only recorded
# here. STIX `created` is the subtle one: on an indicator it holds first_seen,
# but that value is also in `valid_from`, and on a campaign it is also in
# `first_seen` - so a genuine change still shows up in an unmasked field. On
# observed-data and relationship objects `created` is the run clock and nothing
# else.
STAMP_FIELDS = [
    re.compile(r'"(?:generated_at|modified|created|date)":\s*"[^"]*"'),
    re.compile(r'"timestamp":\s*"\d+"'),
    re.compile(r"^# generated: .*$", re.M),
    # Unanchored: these two sit mid-sentence in the README prose, and the
    # anchored versions matched nothing, leaving one file churning on every
    # sync.
    re.compile(r"Generated \S+ from"),
    re.compile(r"Last generated \S+"),
]


def without_stamp(body):
    """The body with every generation timestamp blanked.

    Each file here carries `generated_at`, the export regenerates every 30
    minutes, and the database behind it republishes twice a day. Comparing raw
    bytes rewrites all 3.3 MB of the feed 48 times a day to move one timestamp
    per file - 96 commits of noise for two commits of news, and exactly the
    churn the rest of this pipeline was built to avoid.

    So a file is rewritten only when something other than the clock moved. The
    consequence is deliberate and is stated in the feed README: `generated_at`
    means "when these observations were last different", not "when this script
    last ran". A consumer computing freshness needs to know which of the two it
    is getting.
    """
    for pattern in STAMP_FIELDS:
        body = pattern.sub("<stamp>", body)
    return body


def write_if_changed(path, body, changed):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.isfile(path):
        if without_stamp(open(path, encoding="utf-8").read()) == without_stamp(body):
            return
        # Otherwise the content genuinely moved, and the new stamp goes with it.
    changed.append(os.path.relpath(path))


def commit(path, body):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(body)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("data", help="the export directory")
    ap.add_argument("--db", required=True)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    stats_path = os.path.join(args.data, "stats.json")
    if not os.path.isfile(stats_path):
        print(f"build-feed: no stats.json in {args.data}", file=sys.stderr)
        return 1
    stats = json.load(open(stats_path, encoding="utf-8"))

    # Recency is measured against the export's own generation time, so a feed
    # from a stalled export ages out instead of staying permanently fresh.
    generated_at = parse_ts(stats.get("generated_at")) or dt.datetime.now(dt.timezone.utc)
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=dt.timezone.utc)
    generated_at = generated_at.astimezone(dt.timezone.utc)

    classification_path = os.path.join(args.data, "classification.json")
    recon_signatures = []
    if os.path.isfile(classification_path):
        detail = json.load(open(classification_path, encoding="utf-8"))
        recon_signatures = [c["signature"] for c in detail["clusters"] if c["class"] == "recon"]

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    indicators = build_indicators(db, generated_at, recon_signatures)

    root = os.path.join(args.data, FEED_VERSION)
    feed = os.path.join(root, "feed")
    stamp = generated_at.isoformat().replace("+00:00", "Z")

    files = {
        os.path.join(feed, "high-confidence.txt"): plain_list(
            indicators,
            lambda i: i["confidence"] == "high",
            "Sundew honeypot - high confidence",
            generated_at,
            [
                f"Delivered a payload AND seen within {TTL_DAYS} days.",
                "Reconnaissance-only addresses are excluded by construction.",
            ],
        ),
        os.path.join(feed, "active.txt"): plain_list(
            indicators,
            # Exactly what the tier says: ran a command, seen recently, not a
            # detection sweep. Not "high or medium", which would quietly pull
            # in `persistent` addresses that never ran anything.
            lambda i: i["commands"] > 0 and i["active_within_ttl"] and not i["recon_only"],
            "Sundew honeypot - active",
            generated_at,
            [
                f"Executed at least one command AND seen within {TTL_DAYS} days.",
                "Broader than high-confidence, and correspondingly noisier.",
            ],
        ),
        os.path.join(feed, "indicators.json"): json.dumps(
            {
                "schema_version": SCHEMA_VERSION,
                "generated_at": stamp,
                "ttl_days": TTL_DAYS,
                "source": "https://ap6pack.github.io/dist/honeypot/",
                "licence": "CC BY 4.0",
                "count": len(indicators),
                "indicators": indicators,
            },
            indent=2,
        )
        + "\n",
        os.path.join(feed, "indicators.csv"): to_csv(indicators),
    }

    counts = {
        "total": len(indicators),
        "high": sum(1 for i in indicators if i["confidence"] == "high"),
        "medium": sum(1 for i in indicators if i["confidence"] == "medium"),
        "low": sum(1 for i in indicators if i["confidence"] == "low"),
        "recon_only": sum(1 for i in indicators if i["recon_only"]),
        "fresh": sum(1 for i in indicators if i["active_within_ttl"]),
        "attributed": sum(1 for i in indicators if i["campaign"]),
        # session_count <= 1, not the tier label: an address seen once that
        # also ran a command is tiered `executed_commands`, so counting the
        # label undercounted the thing the README is warning about - 700
        # against the true 1,253.
        "seen_once": sum(1 for i in indicators if i["sessions"] <= 1),
    }

    rule = None
    if os.path.isfile(classification_path):
        rule = json.load(open(classification_path, encoding="utf-8")).get("rule")

    campaigns = build_campaigns(db, args.data, recon_signatures, generated_at)
    files[os.path.join(feed, "campaigns.json")] = json.dumps(campaigns, indent=2) + "\n"
    counts["campaigns"] = campaigns["count"]
    counts["campaigns_with_replay"] = sum(
        1 for c in campaigns["campaigns"] if c["replay_url"]
    )
    counts["campaigns_multi_source"] = sum(
        1 for c in campaigns["campaigns"] if c["source_addresses"] > 1
    )

    techniques = []
    attack_path = os.path.join(args.data, "attack_techniques.json")
    if os.path.isfile(attack_path):
        techniques = json.load(open(attack_path, encoding="utf-8")).get("techniques", [])

    manifest, events = build_misp(indicators, campaigns, generated_at)
    files[os.path.join(feed, "misp", "manifest.json")] = json.dumps(manifest, indent=2) + "\n"
    for ev_uuid, body in events.items():
        files[os.path.join(feed, "misp", f"{ev_uuid}.json")] = json.dumps(body, indent=2) + "\n"
    counts["misp_events"] = len(events)

    bundle = build_stix(indicators, campaigns, techniques, generated_at)
    files[os.path.join(feed, "stix2.json")] = json.dumps(bundle, indent=2) + "\n"
    counts["stix_objects"] = len(bundle["objects"])

    files[os.path.join(feed, "README.md")] = feed_readme(counts, generated_at, rule)
    files[os.path.join(root, "CHANGELOG.md")] = changelog()
    files[os.path.join(root, "README.md")] = version_readme(stamp)

    # The versioned contract surface. Copied rather than moved: the dashboard
    # and every existing consumer read the unversioned paths, and breaking them
    # to announce a stability guarantee would be an unusually pointed joke.
    for name in VERSIONED:
        src = os.path.join(args.data, name)
        if not os.path.isfile(src):
            continue
        doc = json.load(open(src, encoding="utf-8"))
        if isinstance(doc, dict):
            doc = {"schema_version": SCHEMA_VERSION, **doc}
        else:
            doc = {"schema_version": SCHEMA_VERSION, "items": doc}
        files[os.path.join(root, name)] = json.dumps(doc, indent=2) + "\n"
        # And in place, so the unversioned copy carries it too.
        original = json.load(open(src, encoding="utf-8"))
        if isinstance(original, dict) and original.get("schema_version") != SCHEMA_VERSION:
            files[src] = json.dumps(
                {"schema_version": SCHEMA_VERSION, **original}, indent=2
            ) + "\n"

    changed = []
    for path, body in files.items():
        write_if_changed(path, body, changed)

    print("build-feed: tiers", file=sys.stderr)
    for k in ("total", "high", "medium", "low", "recon_only", "fresh", "attributed",
              "campaigns", "campaigns_multi_source", "campaigns_with_replay",
              "misp_events", "stix_objects"):
        print(f"    {k:12} {counts[k]:>6,}", file=sys.stderr)
    print(f"    generated_at {stamp}, ttl {TTL_DAYS}d", file=sys.stderr)

    if not changed:
        print("build-feed: feed already current, nothing to do", file=sys.stderr)
        return 0
    if args.check:
        print(f"build-feed: would write {len(changed)} files", file=sys.stderr)
        return 1
    wanted = {os.path.relpath(p) for p in files}
    for path, body in files.items():
        if os.path.relpath(path) in changed:
            commit(path, body)

    # A campaign that stops appearing leaves its MISP event behind, and a stale
    # event file still listed in no manifest is a broken feed. Remove what this
    # run did not produce.
    misp_dir = os.path.join(feed, "misp")
    removed = 0
    if os.path.isdir(misp_dir):
        for name in os.listdir(misp_dir):
            full = os.path.join(misp_dir, name)
            if name.endswith(".json") and os.path.relpath(full) not in wanted:
                os.remove(full)
                removed += 1
    print(
        f"build-feed: wrote {len(changed)} of {len(files)} files under {FEED_VERSION}/"
        + (f", removed {removed} stale MISP events" if removed else ""),
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
