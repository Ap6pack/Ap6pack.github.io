// Queries run against the published SQLite database directly in the browser.
//
// sql.js-httpvfs is SQLite compiled to WASM with a virtual filesystem that
// fetches pages over HTTP Range requests, so a query reads only the database
// pages it actually touches. Searching a multi-megabyte dataset costs a few KB
// and needs no backend.
//
// Aggregates are materialised at publish time (the ip_top_*, tool_* and
// *_count columns) rather than computed here: walking a table over ranged HTTP
// costs thousands of round trips, while reading a precomputed row costs a
// handful.

import { createDbWorker } from 'sql.js-httpvfs'
import { rangeSql, type Range } from './range'

type Worker = Awaited<ReturnType<typeof createDbWorker>>

/** Resolve against <base> so the app works from any subdirectory. */
function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href
}

let workerPromise: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createDbWorker(
      [{ from: 'jsonconfig', configUrl: assetUrl('data/db/config.json') }],
      assetUrl('sqlite.worker.js'),
      assetUrl('sql-wasm.wasm'),
    )
    // Let a failed load be retried rather than caching the rejection forever.
    workerPromise.catch(() => {
      workerPromise = null
    })
  }
  return workerPromise
}

// sql.js-httpvfs holds one WASM instance, so queries are chained rather than
// run concurrently. Callers can still use Promise.all for readability.
let queue: Promise<unknown> = Promise.resolve()

function query<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const result = queue.then(async () => {
    const worker = await getWorker()
    return (await worker.db.query(sql, params)) as T[]
  })
  queue = result.catch(() => undefined)
  return result
}

export interface TransferStats {
  fetched: number
  total: number
  requests: number
}

export async function getTransferStats(): Promise<TransferStats | null> {
  try {
    const stats = await (await getWorker()).worker.getStats()
    if (!stats) return null
    return {
      fetched: stats.totalFetchedBytes,
      total: stats.totalBytes,
      requests: stats.totalRequests,
    }
  } catch {
    return null
  }
}

/**
 * Timestamp of the newest session in the published database.
 *
 * This is not the same as stats.json's `last_event`: the database is rebuilt on
 * a slower cycle than the 30-minute stats sync, so it trails the headline
 * counters. The Explore UI shows this so an empty short-range search reads as
 * "the data does not reach that far forward yet" rather than a broken filter.
 */
let dataThroughPromise: Promise<Date | null> | null = null

export function getDataThrough(): Promise<Date | null> {
  if (!dataThroughPromise) {
    dataThroughPromise = query<{ max_started_at: string | null }>(
      'SELECT MAX(started_at) AS max_started_at FROM sessions',
    )
      .then((rows) => {
        const value = rows[0]?.max_started_at
        return value ? new Date(value) : null
      })
      .catch(() => null)
  }
  return dataThroughPromise
}

// ---------------------------------------------------------------------------
// Entity lookups
// ---------------------------------------------------------------------------

export interface IpRow {
  ip: string
  first_seen: string
  last_seen: string
  country: string | null
  city: string | null
  isp: string | null
  usage_type: string | null
  abuse_score: number | null
  abuse_reports: number | null
  ai_agent_signal: string | null
  sessions: number
  logins: number
  commands: number
  downloads: number
}

export async function getIp(ip: string): Promise<IpRow | null> {
  const rows = await query<IpRow>(
    `SELECT ip, first_seen, last_seen, country, city, isp, usage_type,
            abuse_score, abuse_reports, ai_agent_signal,
            session_count  AS sessions,
            login_count    AS logins,
            command_count  AS commands,
            download_count AS downloads
     FROM ips WHERE ip = ?`,
    ip,
  )
  return rows[0] ?? null
}

export interface SessionSummary {
  id: string
  started_at: string
  duration_ms: number | null
  protocol: string | null
  command_count: number
  login_success: number
  hassh: string | null
}

export function getIpSessions(ip: string, limit = 50): Promise<SessionSummary[]> {
  return query<SessionSummary>(
    `SELECT s.id, s.started_at, s.duration_ms, s.protocol,
            s.command_count, s.login_success, f.hassh
     FROM sessions s
     JOIN ips i ON i.id = s.ip_id
     LEFT JOIN fingerprints f ON f.id = s.fingerprint_id
     WHERE i.ip = ?
     ORDER BY s.started_at DESC
     LIMIT ${limit}`,
    ip,
  )
}

export interface LabelCount {
  label: string
  extra?: string
  n: number
}

export function getIpTopCommands(ip: string): Promise<LabelCount[]> {
  return query<LabelCount>(
    `SELECT t.text AS label, t.n
     FROM ip_top_commands t JOIN ips i ON i.id = t.ip_id
     WHERE i.ip = ? ORDER BY t.n DESC`,
    ip,
  )
}

export function getIpTopCredentials(ip: string): Promise<LabelCount[]> {
  return query<LabelCount>(
    `SELECT t.username AS label, t.password AS extra, t.n
     FROM ip_top_credentials t JOIN ips i ON i.id = t.ip_id
     WHERE i.ip = ? ORDER BY t.n DESC`,
    ip,
  )
}

export interface SessionDetail {
  id: string
  ip: string
  protocol: string | null
  src_port: number | null
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  login_success: number
  command_count: number
  hassh: string | null
  client: string | null
}

export async function getSession(id: string): Promise<SessionDetail | null> {
  const rows = await query<SessionDetail>(
    `SELECT s.id, i.ip, s.protocol, s.src_port, s.started_at, s.ended_at,
            s.duration_ms, s.login_success, s.command_count,
            f.hassh, cl.version AS client
     FROM sessions s
     JOIN ips i ON i.id = s.ip_id
     LEFT JOIN fingerprints f ON f.id = s.fingerprint_id
     LEFT JOIN clients cl ON cl.id = s.client_id
     WHERE s.id = ?`,
    id,
  )
  return rows[0] ?? null
}

export interface CommandRow {
  text: string
  ts: string
}

export function getSessionCommands(id: string, limit = 500): Promise<CommandRow[]> {
  return query<CommandRow>(
    `SELECT c.text, sc.ts
     FROM session_commands sc
     JOIN commands c ON c.id = sc.command_id
     WHERE sc.session_id = ?
     ORDER BY sc.ts
     LIMIT ${limit}`,
    id,
  )
}

export interface LoginRow {
  username: string
  password: string
  success: number
  ts: string
}

export function getSessionLogins(id: string, limit = 200): Promise<LoginRow[]> {
  return query<LoginRow>(
    `SELECT username, password, success, ts FROM logins
     WHERE session_id = ? ORDER BY ts LIMIT ${limit}`,
    id,
  )
}

export interface FingerprintRow {
  hassh: string
  algorithms: string | null
  sessions: number
  distinct_ips: number
  first_seen: string
  last_seen: string
}

export async function getTool(hassh: string): Promise<FingerprintRow | null> {
  const rows = await query<FingerprintRow>(
    `SELECT hassh, algorithms,
            session_count     AS sessions,
            distinct_ip_count AS distinct_ips,
            first_seen, last_seen
     FROM fingerprints WHERE hassh = ?`,
    hassh,
  )
  return rows[0] ?? null
}

export function getToolIps(hassh: string, limit = 50): Promise<LabelCount[]> {
  return query<LabelCount>(
    `SELECT t.ip AS label, t.n
     FROM tool_ips t JOIN fingerprints f ON f.id = t.fingerprint_id
     WHERE f.hassh = ? ORDER BY t.n DESC LIMIT ${limit}`,
    hassh,
  )
}

export function getToolTopCommands(hassh: string): Promise<LabelCount[]> {
  return query<LabelCount>(
    `SELECT t.text AS label, t.n
     FROM tool_top_commands t JOIN fingerprints f ON f.id = t.fingerprint_id
     WHERE f.hassh = ? ORDER BY t.n DESC`,
    hassh,
  )
}

export function getToolTopCredentials(hassh: string): Promise<LabelCount[]> {
  return query<LabelCount>(
    `SELECT t.username AS label, t.password AS extra, t.n
     FROM tool_top_credentials t JOIN fingerprints f ON f.id = t.fingerprint_id
     WHERE f.hassh = ? ORDER BY t.n DESC`,
    hassh,
  )
}

export interface ToolListRow {
  hassh: string
  sessions: number
  distinct_ips: number
  last_seen: string
}

export function listTools(): Promise<ToolListRow[]> {
  return query<ToolListRow>(
    `SELECT hassh,
            session_count     AS sessions,
            distinct_ip_count AS distinct_ips,
            last_seen
     FROM fingerprints
     WHERE session_count > 0
     ORDER BY session_count DESC`,
  )
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const SEARCH_LIMIT = 25

export interface SearchIpRow {
  ip: string
  sessions: number
  first_seen: string
  last_seen: string
  country: string | null
}

export interface SearchCommandRow {
  text: string
  uses: number
  distinct_ips: number
}

export interface SearchCredentialRow {
  username: string
  password: string
  attempts: number
}

export interface SearchSessionRow {
  id: string
  ip: string
  started_at: string
  command_count: number
}

export interface SearchResults {
  ips: SearchIpRow[]
  commands: SearchCommandRow[]
  credentials: SearchCredentialRow[]
  sessions: SearchSessionRow[]
  /** True when results were filtered to a time range rather than all time. */
  scoped: boolean
}

/**
 * All-time search. Reads the precomputed totals (`session_count`, `uses`,
 * `attempts`) instead of aggregating, so it stays cheap.
 *
 * Credentials and session ids match with GLOB against lowercased columns rather
 * than LIKE: SQLite's case-insensitive LIKE cannot use a BINARY index and
 * degrades to a full table scan.
 */
async function searchAllTime(term: string): Promise<SearchResults> {
  const like = `%${term}%`
  const glob = `${term.toLowerCase()}*`

  const [ips, commands, credentials, sessions] = await Promise.all([
    query<SearchIpRow>(
      `SELECT ip, session_count AS sessions, first_seen, last_seen, country
       FROM ips WHERE ip LIKE ? AND session_count > 0
       ORDER BY session_count DESC LIMIT ${SEARCH_LIMIT}`,
      like,
    ),
    query<SearchCommandRow>(
      `SELECT text, uses, distinct_ips FROM commands
       WHERE text LIKE ? AND uses > 0
       ORDER BY uses DESC LIMIT ${SEARCH_LIMIT}`,
      like,
    ),
    query<SearchCredentialRow>(
      `SELECT username, password, attempts FROM credentials
       WHERE username_lc GLOB ? OR password_lc GLOB ?
       ORDER BY attempts DESC LIMIT ${SEARCH_LIMIT}`,
      glob,
      glob,
    ),
    query<SearchSessionRow>(
      `SELECT s.id, i.ip, s.started_at, s.command_count
       FROM sessions s JOIN ips i ON i.id = s.ip_id
       WHERE s.id GLOB ?
       ORDER BY s.started_at DESC LIMIT ${SEARCH_LIMIT}`,
      glob,
    ),
  ])

  return { ips, commands, credentials, sessions, scoped: false }
}

/**
 * Time-scoped search. The precomputed totals cover all history, so a bounded
 * window has to aggregate live over the event tables.
 */
async function searchInRange(term: string, range: Range): Promise<SearchResults> {
  const like = `%${term}%`
  const prefix = `${term}%`
  const bySession = rangeSql(range, 's.started_at')
  const byCommand = rangeSql(range, 'sc.ts')
  const byLogin = rangeSql(range, 'l.ts')

  const [ips, commands, credentials, sessions] = await Promise.all([
    query<SearchIpRow>(
      `SELECT i.ip, COUNT(s.id) AS sessions,
              MIN(s.started_at) AS first_seen, MAX(s.started_at) AS last_seen,
              i.country
       FROM ips i JOIN sessions s ON s.ip_id = i.id
       WHERE i.ip LIKE ? AND ${bySession.sql}
       GROUP BY i.id ORDER BY sessions DESC LIMIT ${SEARCH_LIMIT}`,
      like,
      ...bySession.params,
    ),
    query<SearchCommandRow>(
      `SELECT c.text, COUNT(sc.id) AS uses, COUNT(DISTINCT sc.ip_id) AS distinct_ips
       FROM commands c JOIN session_commands sc ON sc.command_id = c.id
       WHERE c.text LIKE ? AND ${byCommand.sql}
       GROUP BY c.id ORDER BY uses DESC LIMIT ${SEARCH_LIMIT}`,
      like,
      ...byCommand.params,
    ),
    query<SearchCredentialRow>(
      `SELECT l.username, l.password, COUNT(*) AS attempts
       FROM logins l
       WHERE (l.username LIKE ? OR l.password LIKE ?) AND ${byLogin.sql}
       GROUP BY l.username, l.password
       ORDER BY attempts DESC LIMIT ${SEARCH_LIMIT}`,
      prefix,
      prefix,
      ...byLogin.params,
    ),
    query<SearchSessionRow>(
      `SELECT s.id, i.ip, s.started_at, s.command_count
       FROM sessions s JOIN ips i ON i.id = s.ip_id
       WHERE s.id LIKE ? AND ${bySession.sql}
       ORDER BY s.started_at DESC LIMIT ${SEARCH_LIMIT}`,
      prefix,
      ...bySession.params,
    ),
  ])

  return { ips, commands, credentials, sessions, scoped: true }
}

export function search(term: string, range: Range): Promise<SearchResults> {
  return range.from === null && range.to === null
    ? searchAllTime(term)
    : searchInRange(term, range)
}

export function countResults(results: SearchResults): number {
  return (
    results.ips.length +
    results.commands.length +
    results.credentials.length +
    results.sessions.length
  )
}
