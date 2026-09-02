# Sundew honeypot indicator feed

Generated 2026-09-02T12:00:13.262241Z from a single Cowrie SSH/Telnet honeypot on one AWS EC2
instance. Schema `1.0`, feed `v1`. Licence: CC BY 4.0.

## Read this before you block anything

**Presence in this feed means traffic reached a honeypot from that address. It
does not mean the address's owner did anything wrong.** A large share of what
arrives at any honeypot comes from compromised third parties - home routers,
IP cameras, small business servers - whose owners have no idea. Many sit on
residential ranges with dynamic addresses, so the address that attacked
yesterday may belong to somebody uninvolved today.

That is why every indicator carries `last_seen` and `ttl_days`, and why more
than half of what this honeypot has seen is deliberately kept out of the
confident tiers. Of 3,011 observed addresses,
1,735 were seen exactly once - 57% of the feed.

**Removal.** If your address is listed and you believe it should not be, open
an issue at <https://github.com/Ap6pack/Ap6pack.github.io/issues> or email the
contact in `/.well-known/security.txt`. Include the address and a rough time
window. Removal requests are honoured; there is no appeal process to exhaust.

## Files

| File | What it is |
|---|---|
| `high-confidence.txt` | Delivered a payload **and** seen within 7 days. Plain text, one address per line, `#` comments. Drop-in for blocklist tooling. |
| `active.txt` | Ran at least one command **and** seen within 7 days. Broader, noisier. |
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
fresh          := last_seen >= generated_at - 7 days
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
| high | 66 |
| medium | 364 |
| low | 2,581 |
| **total** | **3,011** |

Every field the tiers are derived from is in `indicators.json`. If you disagree
with where the lines are drawn - and you may well, they are one operator's
judgement - re-derive your own from that file. Nothing here is hidden behind
the tiering.

## Reconnaissance is separated, not deleted

One behaviour cluster on this sensor runs `echo -e "\x6F\x6B"` - which prints
`ok` - to test whether the shell is real, then disconnects after about two
seconds. It accounts for around 80% of all sessions from five addresses.

A cluster is classified as reconnaissance when **all** of: one command per
session, average duration under 5.0s, and no downloads from any of its
sessions. Addresses whose every clustered session is reconnaissance carry
`recon_only: true` and are excluded from `high` and `medium` by construction -
scanning for honeypots is not evidence of an attack. They stay in
`indicators.json`, because a sweep at that scale is worth knowing about.

16 addresses are currently `recon_only`.

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
