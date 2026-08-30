# Dataset changelog

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
