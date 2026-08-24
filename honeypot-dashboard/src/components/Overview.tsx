import { formatTimestamp } from '../lib/format'
import type { Section } from '../lib/routing'
import type { ReplaySession, Stats } from '../lib/types'
import { StatTile } from './charts'
import { TerminalReplay } from './TerminalReplay'

const GlobeIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
  </svg>
)

const LockIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
)

const TerminalIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 9l3 3-3 3M13 15h4" />
  </svg>
)

const ShieldIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4Z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
)

export function Overview({
  stats,
  session,
  onNavigate,
}: {
  stats: Stats
  session: ReplaySession | null
  onNavigate: (section: Section) => void
}) {
  return (
    <div className="panel">
      <section className="hero">
        <h1>Honeypot Data</h1>
        <p>
          A live{' '}
          <a href="https://github.com/cowrie/cowrie" target="_blank" rel="noopener">
            Cowrie
          </a>{' '}
          SSH/Telnet honeypot runs on a small AWS EC2 instance, exposed to the open
          internet. Below is a real captured attacker session, replayed keystroke by
          keystroke - not a simulation.
        </p>
        <p className="hero__meta">
          Last synced: {formatTimestamp(stats.generated_at)} · data refreshes
          automatically about every 30 minutes
        </p>
      </section>

      <section className="charts-row charts-row--single">
        <TerminalReplay session={session} />
      </section>

      <section className="kpi-row">
        <StatTile
          label="Unique attacker IPs"
          value={stats.unique_source_ips}
          accent="var(--cat-1)"
          onClick={() => onNavigate('geography')}
          icon={GlobeIcon}
        />
        <StatTile
          label="Login attempts"
          value={stats.login_attempts}
          accent="var(--cat-2)"
          onClick={() => onNavigate('credentials')}
          icon={LockIcon}
        />
        <StatTile
          label="Commands run"
          value={stats.commands_run}
          accent="var(--cat-6)"
          onClick={() => onNavigate('activity')}
          icon={TerminalIcon}
        />
        <StatTile
          label="Malware samples captured"
          value={stats.files_captured}
          accent="var(--cat-8)"
          onClick={() => onNavigate('samples')}
          icon={ShieldIcon}
        />
      </section>
    </div>
  )
}
