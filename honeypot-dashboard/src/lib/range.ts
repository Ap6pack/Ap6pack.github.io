// Time-range selection for Explore.
//
// A range is either a rolling preset ("last 6h"), an explicit custom window, or
// all time. `from`/`to` are ISO strings compared directly against the SQLite
// text timestamps, which are stored UTC ISO-8601 and therefore sort lexically.

export type RangeKey = '1h' | '6h' | '24h' | '7d' | '30d' | 'all' | 'custom'

export interface Range {
  key: RangeKey
  from: string | null
  to: string | null
}

/** Preset window lengths, in hours. */
const PRESET_HOURS: Record<string, number> = {
  '1h': 1,
  '6h': 6,
  '24h': 24,
  '7d': 168,
  '30d': 720,
}

export interface Preset {
  key: RangeKey
  label: string
  hours: number | null
}

export const PRESETS: Preset[] = [
  { key: '1h', label: '1h', hours: 1 },
  { key: '6h', label: '6h', hours: 6 },
  { key: '24h', label: '24h', hours: 24 },
  { key: '7d', label: '7d', hours: 168 },
  { key: '30d', label: '30d', hours: 720 },
  { key: 'all', label: 'All', hours: null },
]

export const ALL_TIME: Range = { key: 'all', from: null, to: null }

export function presetRange(key: RangeKey): Range {
  const hours = PRESET_HOURS[key]
  if (hours === undefined) return { key, from: null, to: null }
  return {
    key,
    from: new Date(Date.now() - hours * 3_600_000).toISOString(),
    to: null,
  }
}

/** Build a range from two `yyyy-mm-dd` date-input values. */
export function customRange(from: string, to: string): Range {
  return {
    key: 'custom',
    from: from ? `${from}T00:00:00.000000Z` : null,
    to: to ? `${to}T23:59:59.999999Z` : null,
  }
}

/** Render a range as a SQL predicate over `column`, plus its bind params. */
export function rangeSql(range: Range, column: string): { sql: string; params: string[] } {
  const clauses: string[] = []
  const params: string[] = []
  if (range.from) {
    clauses.push(`${column} >= ?`)
    params.push(range.from)
  }
  if (range.to) {
    clauses.push(`${column} <= ?`)
    params.push(range.to)
  }
  return { sql: clauses.length ? clauses.join(' AND ') : '1=1', params }
}

export function describeRange(range: Range): string {
  if (range.key === 'all') return 'all time'
  if (range.key === 'custom') {
    const from = range.from ? range.from.slice(0, 10) : 'start'
    const to = range.to ? range.to.slice(0, 10) : 'now'
    return `${from} to ${to}`
  }
  const preset = PRESETS.find((p) => p.key === range.key)
  return preset ? `last ${preset.label}` : range.key
}

/**
 * Whether a preset's whole window sits after the last event in the published
 * database, which means it can only ever return nothing.
 *
 * The dashboard has two clocks. stats.json is republished every 30 minutes, but
 * the queryable database is rebuilt on a slower cycle, so the headline counters
 * can be hours ahead of what Explore can actually search. Without this, the
 * short presets look broken: you pick "1h", get zero rows, and conclude the
 * filter is faulty rather than that the data does not reach that far forward.
 */
export function presetOutrunsData(preset: Preset, dataThrough: Date | null): boolean {
  if (!dataThrough || preset.hours === null) return false
  return Date.now() - preset.hours * 3_600_000 > dataThrough.getTime()
}

/** Human-readable lag, e.g. "1h 20m". Returns null for anything under a minute. */
export function describeLag(dataThrough: Date | null): string | null {
  if (!dataThrough) return null
  const ms = Date.now() - dataThrough.getTime()
  if (ms < 60_000) return null
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}
