#!/usr/bin/env python3
"""Separate reconnaissance from attack, and weight the headline figures by source.

    classify-traffic.py DATADIR --db DB           # write the classification
    classify-traffic.py DATADIR --db DB --check   # report, write nothing

THE PROBLEM

Session- and event-weighted totals on this dashboard describe a handful of
hosts rather than the internet. Measured 2026-08-30 against the published
export:

    cluster eafdc691c2945a06   73,624 sessions   79.8% of all clustered
                               5 addresses       0.22% of 2,254
    top three clusters         97.1% of all clustered sessions
    ATT&CK T1027               74,694 matches    95.4% of everything tagged

The command behind eafdc691c2945a06 is `echo -e "\\x6F\\x6B"`. `\\x6F\\x6B`
decodes to `ok`: it is a honeypot-detection probe, testing whether the shell
interprets hex escapes. Sessions average 2.2 seconds, run that one command and
disconnect. It is not an attack, and letting it carry four fifths of every
total means every total answers a question nobody asked.

    https://isc.sans.edu/diary/31064

WHAT THIS DOES NOT DO

It does not delete the probe. A detection sweep running 73,624 times from five
hosts is a real and interesting observation - it is only worthless as a
denominator. Everything here is a split, never a filter.

THE RULE

A behaviour cluster is reconnaissance when all three hold:

    exactly one command per session
    average session duration under 5 seconds
    no downloads from any of its sessions

Three conditions, because each alone is wrong. `6a844424c30ada56` runs five
commands over three minutes and would survive a duration-only rule; the
`/bin/busybox` probe runs two commands from 294 separate addresses and is the
most widely deployed thing in the capture, which a command-count-only rule
would throw away. Against the current export the rule selects 8 clusters of
106, carrying 79.9% of clustered sessions, and the residue behaves like
attack traffic.

WHY THE CAPTURE-WIDE COUNTERS

`ips.*` and `commands.uses` are whole-capture counters that survive into the
published database even though `sessions` and `session_commands` are pruned:

    SUM(ips.session_count)  97,439      COUNT(sessions)          7,468
    SUM(commands.uses)     175,823      COUNT(session_commands) 17,765

So the weighting can be computed exactly here, in CI, over a 12 MB file -
without the honeypot machine and without re-deriving anything.

ATT&CK ATTRIBUTION IS BY CONTAINMENT, NOT BY RE-MATCHING

attack_techniques.json is produced on the machine by a regex matcher this
script does not have. Re-implementing it would risk disagreeing with the file
it is annotating, so nothing here re-matches anything. Instead: a recon command
run `u` times can only belong to a technique whose total is at least `u`. When
exactly one technique clears that bar, the attribution is certain by
elimination - for `echo -e "\\x6F\\x6B"` at 73,624 uses, only T1027 (74,694) can
hold it. When more than one clears it, the command is left unattributed and
said to be. A guess is worse than a gap here, because the gap is visible.

IDEMPOTENT

Re-running over an already-classified export writes byte-identical files, so
CI commits nothing.
"""

import argparse
import json
import os
import sqlite3
import sys

SCHEMA_VERSION = "1.0"

# The rule, in one place, because it is quoted in the UI and in the feed README
# and those must not drift from what actually ran.
RULE = {
    "max_commands_per_session": 1,
    "max_avg_duration_ms": 5000,
    "max_downloads": 0,
}

# Below this share of a total, a dominance disclosure is noise rather than a
# warning. The work order says "~50%".
DOMINANCE_THRESHOLD = 0.5


def classify_clusters(db):
    """Every behaviour cluster, with the three facts the rule needs."""
    rows = db.execute(
        """
        SELECT c.signature, c.session_count, c.ip_count, c.command_count,
               c.first_seen, c.last_seen, c.representative,
               (SELECT AVG(s.duration_ms) FROM sessions s
                  WHERE s.cluster_signature = c.signature) AS avg_ms,
               (SELECT COUNT(*) FROM downloads d
                  JOIN sessions s2 ON s2.id = d.session_id
                 WHERE s2.cluster_signature = c.signature) AS downloads
          FROM behavior_clusters c
        """
    ).fetchall()

    out = []
    for r in rows:
        avg = r["avg_ms"]
        # A cluster with no surviving session cannot be measured for duration.
        # Unmeasurable is not recon: the rule has to be able to fail closed.
        recon = (
            r["command_count"] <= RULE["max_commands_per_session"]
            and avg is not None
            and avg < RULE["max_avg_duration_ms"]
            and r["downloads"] <= RULE["max_downloads"]
        )
        out.append(
            {
                "signature": r["signature"],
                "class": "recon" if recon else "attack",
                "sessions": r["session_count"],
                "ips": r["ip_count"],
                "commands_per_session": r["command_count"],
                "avg_duration_ms": None if avg is None else round(avg),
                "downloads": r["downloads"],
                "first_seen": r["first_seen"],
                "last_seen": r["last_seen"],
                "representative": r["representative"],
            }
        )
    out.sort(key=lambda c: (-c["sessions"], c["signature"]))
    return out


def recon_commands(db, recon_signatures):
    """Command texts run ONLY by recon clusters, with capture-wide use counts.

    Exclusivity is the whole game. `commands.uses` counts every run of a text
    across the capture, so crediting it to recon is only sound when nothing
    else runs that text. `echo -e "\\x6F\\x6B"` is exclusive - 73,624 uses from
    5 addresses, exactly the one cluster. `enable` is not: it is the opening
    command of a short recon cluster AND of 6a844424c30ada56, which runs five
    commands over three minutes from 309 addresses. Attributing its 16,937 uses
    to recon on the strength of the first pushed T1027's residue to -15,867 -
    an impossible number, which is how the flaw surfaced.

    The sessions table is pruned, so this can only prove exclusivity among the
    sessions that survived. That is a real limit and it fails safe: a text
    shared with an attack cluster whose sessions were all pruned would be
    wrongly called exclusive, so the caller checks the arithmetic as well.
    """
    if not recon_signatures:
        return []
    marks = ",".join("?" * len(recon_signatures))
    rows = db.execute(
        f"""
        SELECT cm.text, cm.uses, cm.distinct_ips,
               SUM(CASE WHEN s.cluster_signature IN ({marks}) THEN 1 ELSE 0 END) AS recon_rows,
               COUNT(*) AS all_rows
          FROM session_commands sc
          JOIN sessions s  ON s.id = sc.session_id
          JOIN commands cm ON cm.id = sc.command_id
         GROUP BY cm.id
        HAVING recon_rows > 0 AND recon_rows = all_rows
        """,
        recon_signatures,
    ).fetchall()
    return sorted(
        ({"text": r["text"], "uses": r["uses"], "distinct_ips": r["distinct_ips"]} for r in rows),
        key=lambda c: -c["uses"],
    )


def attribute_techniques(techniques, commands):
    """Split each technique's count into a recon share and a residue.

    Containment only: a command used `u` times fits inside a technique only if
    that technique's total is at least `u`. One candidate means certainty by
    elimination; more than one means the command is left out and said to be.

    Containment is then checked again on the sum. Two commands can each fit a
    technique alone and not together, and a text wrongly judged exclusive (see
    recon_commands) would show up the same way. Either produces a recon share
    above the technique's own total, which is impossible - so the whole
    attribution for that technique is dropped rather than clamped. A gap is
    visible; a clamped number reads as a measurement.
    """
    out = []
    attributed = {}
    unattributed = []

    for cmd in commands:
        holders = [t for t in techniques if t.get("count", 0) >= cmd["uses"]]
        if len(holders) == 1:
            attributed.setdefault(holders[0]["id"], []).append(cmd)
        else:
            unattributed.append(cmd)

    for t in techniques:
        mine = attributed.get(t["id"], [])
        recon_count = sum(c["uses"] for c in mine)
        if recon_count > t.get("count", 0):
            unattributed.extend(mine)
            mine, recon_count = [], 0
        out.append(
            {
                "id": t["id"],
                "name": t.get("name"),
                "count": t.get("count", 0),
                "distinct_ips": t.get("distinct_ips", 0),
                "recon_count": recon_count,
                "recon_ips": max((c["distinct_ips"] for c in mine), default=0),
                "residual_count": t.get("count", 0) - recon_count,
                "attribution": "certain" if mine else "none",
            }
        )
        assert out[-1]["residual_count"] >= 0, f"{t['id']} residual went negative"
    return out, sorted(unattributed, key=lambda c: -c["uses"])


def dominance(entries, total, sources_total, metric, label):
    """A disclosure when one contributor carries more than half of a total."""
    if not entries or total <= 0:
        return None
    top = max(entries, key=lambda e: e["value"])
    if top["value"] / total < DOMINANCE_THRESHOLD:
        return None
    return {
        "metric": metric,
        "label": label,
        "total": total,
        "top_label": top["label"],
        "top_value": top["value"],
        "top_share": round(top["value"] / total, 4),
        "top_sources": top["sources"],
        "sources_total": sources_total,
    }


def build(db, attack):
    clusters = classify_clusters(db)
    one = lambda sql: db.execute(sql).fetchone()[0]

    recon = [c for c in clusters if c["class"] == "recon"]
    atk = [c for c in clusters if c["class"] == "attack"]
    clustered = sum(c["sessions"] for c in clusters)

    # Two source-weighted views of the same question, because they differ and
    # the difference is the pruning. `ips` itself is complete - all 2,254 rows
    # ship - and its counters are capture-wide, so `capture` is the honest
    # answer to "how many hosts did this". But the pages these tiles open are
    # backed by the pruned child tables, which know about fewer: 781 addresses
    # have a surviving login row against 880 that ever sent one. Showing the
    # capture figure on a tile that opens the smaller page is OV-8 again, so
    # the tile leads with `published` and the capture figure is stated beside
    # it rather than instead of it.
    ips_observed = one("SELECT COUNT(*) FROM ips")
    ip_weighted = {
        "observed": ips_observed,
        "attempted_login": one("SELECT COUNT(*) FROM ips WHERE login_count > 0"),
        "ran_command": one("SELECT COUNT(*) FROM ips WHERE command_count > 0"),
        "delivered_payload": one("SELECT COUNT(*) FROM ips WHERE download_count > 0"),
        "published": {
            "observed": ips_observed,
            "attempted_login": one("SELECT COUNT(DISTINCT ip_id) FROM logins"),
            "ran_command": one("SELECT COUNT(DISTINCT ip_id) FROM session_commands"),
            "delivered_payload": one(
                "SELECT COUNT(DISTINCT ip_id) FROM downloads WHERE shasum IS NOT NULL"
            ),
        },
    }

    techniques, unattributed = attribute_techniques(
        attack.get("techniques", []),
        recon_commands(db, [c["signature"] for c in recon]),
    )

    disclosures = []
    d = dominance(
        [{"label": c["signature"], "value": c["sessions"], "sources": c["ips"]} for c in clusters],
        clustered,
        ips_observed,
        "sessions",
        "sessions in a behaviour cluster",
    )
    if d:
        disclosures.append(d)
    d = dominance(
        [
            {"label": t["id"], "value": t["count"], "sources": t["distinct_ips"]}
            for t in techniques
        ],
        sum(t["count"] for t in techniques),
        ips_observed,
        "attack_techniques",
        "commands tagged with an ATT&CK technique",
    )
    if d:
        disclosures.append(d)

    summary = {
        "schema_version": SCHEMA_VERSION,
        "rule": RULE,
        "clustered_sessions": clustered,
        "ips": ip_weighted,
        "recon": {
            "clusters": len(recon),
            "sessions": sum(c["sessions"] for c in recon),
            # Clusters can share an address, so this is an upper bound rather
            # than a union - named so it cannot be read as one.
            "ip_count_sum": sum(c["ips"] for c in recon),
            "share_of_clustered_sessions": round(
                sum(c["sessions"] for c in recon) / clustered, 4
            )
            if clustered
            else 0,
        },
        "attack": {
            "clusters": len(atk),
            "sessions": sum(c["sessions"] for c in atk),
            "ip_count_sum": sum(c["ips"] for c in atk),
        },
        "dominance": disclosures,
    }

    detail = {
        "schema_version": SCHEMA_VERSION,
        "rule": RULE,
        "summary": summary,
        "clusters": clusters,
        "attack_techniques": techniques,
        "unattributed_recon_commands": unattributed,
    }
    return summary, detail


def write_json(path, payload):
    """Write only when the bytes change, so CI has nothing to commit on a no-op."""
    body = json.dumps(payload, indent=2) + "\n"
    if os.path.isfile(path) and open(path, encoding="utf-8").read() == body:
        return False
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(body)
    os.replace(tmp, path)
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("data", help="the export directory holding stats.json")
    ap.add_argument("--db", required=True, help="the assembled database")
    ap.add_argument("--check", action="store_true", help="report only; exit 1 if it would write")
    args = ap.parse_args()

    stats_path = os.path.join(args.data, "stats.json")
    attack_path = os.path.join(args.data, "attack_techniques.json")
    detail_path = os.path.join(args.data, "classification.json")
    for p in (stats_path, attack_path):
        if not os.path.isfile(p):
            print(f"classify-traffic: missing {p}", file=sys.stderr)
            return 1

    db = sqlite3.connect(args.db)
    db.row_factory = sqlite3.Row
    attack = json.load(open(attack_path, encoding="utf-8"))
    summary, detail = build(db, attack)

    stats = json.load(open(stats_path, encoding="utf-8"))
    changed_stats = stats.get("weighting") != summary
    stats["weighting"] = summary

    r, a = summary["recon"], summary["attack"]
    print("classify-traffic: session weight vs source weight", file=sys.stderr)
    print(
        f"    recon    {r['clusters']:>3} clusters  {r['sessions']:>7,} sessions "
        f"({r['share_of_clustered_sessions'] * 100:.1f}%)  <= {r['ip_count_sum']} addresses",
        file=sys.stderr,
    )
    print(
        f"    attack   {a['clusters']:>3} clusters  {a['sessions']:>7,} sessions "
        f"           <= {a['ip_count_sum']} addresses",
        file=sys.stderr,
    )
    ip = summary["ips"]
    print(
        f"    addresses  login {ip['published']['attempted_login']:>5,}/{ip['attempted_login']:<5,}"
        f"  command {ip['published']['ran_command']:>5,}/{ip['ran_command']:<5,}"
        f"  payload {ip['published']['delivered_payload']:>5,}/{ip['delivered_payload']:<5,}"
        "   (published/capture)",
        file=sys.stderr,
    )
    for d in summary["dominance"]:
        print(
            f"    dominance: {d['top_share'] * 100:.1f}% of {d['label']} "
            f"from {d['top_sources']} of {d['sources_total']:,} addresses ({d['top_label']})",
            file=sys.stderr,
        )
    for t in detail["attack_techniques"]:
        if t["recon_count"]:
            print(
                f"    {t['id']}: {t['recon_count']:,} of {t['count']:,} matches are recon "
                f"({t['attribution']}), {t['residual_count']:,} left",
                file=sys.stderr,
            )
    if detail["unattributed_recon_commands"]:
        n = len(detail["unattributed_recon_commands"])
        u = sum(c["uses"] for c in detail["unattributed_recon_commands"])
        print(f"    {n} recon commands ({u:,} uses) not attributable by containment", file=sys.stderr)

    detail_body = json.dumps(detail, indent=2) + "\n"
    changed_detail = (
        not os.path.isfile(detail_path)
        or open(detail_path, encoding="utf-8").read() != detail_body
    )

    if not changed_stats and not changed_detail:
        print("classify-traffic: already classified, nothing to do", file=sys.stderr)
        return 0

    if args.check:
        print("classify-traffic: files would be updated", file=sys.stderr)
        return 1

    write_json(detail_path, detail)
    tmp = stats_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(stats, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, stats_path)
    print("classify-traffic: stats.json carries a `weighting` block; classification.json written",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
