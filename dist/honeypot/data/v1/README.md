# Sundew dataset, v1

Data from a live Cowrie SSH/Telnet honeypot on one AWS EC2 instance, published
every 30 minutes. Last generated 2026-08-30T20:00:12.617911Z.

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
