// Shapes of the JSON the honeypot box publishes into dist/honeypot/data/.

export interface Stats {
  generated_at: string
  first_event: string
  last_event: string
  total_events: number
  unique_sessions: number
  unique_source_ips: number
  login_attempts: number
  login_success: number
  commands_run: number
  files_captured: number
  top_usernames: [string, number][]
  top_passwords: [string, number][]
  event_breakdown: Record<string, number>
  daily_events: { date: string; count: number }[]
}

export interface Sample {
  sha256: string
  size: number
  zip: string
  vt_positives?: number
  vt_total?: number
  vt_permalink?: string
}

export interface GeoPoint {
  ip: string
  lat: number
  lon: number
  country?: string | null
  city?: string | null
  isp?: string | null
  usage_type?: string | null
  abuse_score?: number
  abuse_reports?: number
  domain?: string | null
  tor_exit?: boolean
  hassh?: string | null
  hassh_shared_count?: number
  ai_agent_signal?: string | null
  sessions?: number
}

export interface FallbackEntry {
  command: string
  output: string
  exit_code: number
}

export interface AttackTechnique {
  id: string
  name: string
  tactics: string[]
  count: number
  examples: string[]
}

export interface AttackData {
  techniques: AttackTechnique[]
  total_matches?: number
  distinct_techniques?: number
}

export interface ReplayEvent {
  t: number
  dir: 'input' | 'output'
  text: string
}

export interface ReplaySession {
  src_ip: string
  timestamp: string
  duration_ms: number
  events: ReplayEvent[]
}

export type ReplayMap = Record<string, ReplaySession>
