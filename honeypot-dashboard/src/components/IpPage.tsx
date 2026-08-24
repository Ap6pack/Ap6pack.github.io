import { useEffect, useState } from 'react'
import {
  getIp,
  getIpSessions,
  getIpTopCommands,
  getIpTopCredentials,
  type IpRow,
  type LabelCount,
  type SessionSummary,
} from '../lib/db'
import { formatDuration, formatTimestamp } from '../lib/format'
import { routeHref } from '../lib/routing'
import { BackLink, CountTable, EntitySection, Fact, ToolLink } from './entity'

export function IpPage({ ip }: { ip: string }) {
  const [row, setRow] = useState<IpRow | null | 'loading'>('loading')
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [commands, setCommands] = useState<LabelCount[]>([])
  const [credentials, setCredentials] = useState<LabelCount[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRow('loading')
    setError(null)

    Promise.all([getIp(ip), getIpSessions(ip), getIpTopCommands(ip), getIpTopCredentials(ip)])
      .then(([found, sessionRows, commandRows, credentialRows]) => {
        if (cancelled) return
        setRow(found)
        setSessions(sessionRows)
        setCommands(commandRows)
        setCredentials(credentialRows)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [ip])

  const confirmed = row && row !== 'loading' && row.ai_agent_signal === 'confirmed'

  return (
    <div className="panel">
      <BackLink />
      <h1 className="entity__title">{ip}</h1>

      {error && <p className="entity__missing">Could not load: {error}</p>}
      {row === 'loading' && !error && <p className="entity__loading">Loading…</p>}
      {row === null && !error && (
        <p className="entity__missing">This address has not been seen by the honeypot.</p>
      )}

      {row && row !== 'loading' && (
        <>
          <p className="entity__subtitle">
            {[row.city, row.country].filter(Boolean).join(', ') || 'Location unknown'}
            {row.isp ? ` · ${row.isp}` : ''}
          </p>

          <div className="entity__facts">
            <Fact label="Sessions" value={row.sessions.toLocaleString()} />
            <Fact label="Login attempts" value={row.logins.toLocaleString()} />
            <Fact label="Commands" value={row.commands.toLocaleString()} />
            <Fact label="Downloads" value={row.downloads.toLocaleString()} />
            <Fact label="First seen" value={formatTimestamp(row.first_seen)} small />
            <Fact label="Last seen" value={formatTimestamp(row.last_seen)} small />
            {row.abuse_score !== null && (
              <Fact
                label="AbuseIPDB"
                value={`${row.abuse_score}% · ${row.abuse_reports ?? 0} reports`}
                small
              />
            )}
            {row.usage_type && <Fact label="Usage type" value={row.usage_type} small />}
            {row.ai_agent_signal && (
              <Fact
                label="AI agent signal"
                small
                value={
                  <span
                    className={`entity__badge ${
                      confirmed ? 'entity__badge--fail' : 'entity__badge--ok'
                    }`}
                  >
                    {row.ai_agent_signal}
                  </span>
                }
              />
            )}
          </div>

          {row.ai_agent_signal && (
            <p className="entity__subtitle">
              {confirmed
                ? 'A session from this address followed an instruction planted in the login banner — behaviour expected of an LLM-driven agent rather than a human or a fixed script.'
                : 'Command timing from this address matches an LLM-driven agent more closely than a human or a hardcoded script. Weaker than a confirmed match.'}
            </p>
          )}

          <EntitySection title="Most-run commands">
            <CountTable rows={commands} keyLabel="Command" valueLabel="Times" />
          </EntitySection>

          <EntitySection title="Credentials tried">
            <CountTable
              rows={credentials}
              keyLabel="Username"
              extraLabel="Password"
              valueLabel="Attempts"
            />
          </EntitySection>

          <EntitySection
            title={`Sessions (${sessions.length}${
              row.sessions > sessions.length ? ` of ${row.sessions.toLocaleString()}` : ''
            })`}
          >
            {sessions.length === 0 ? (
              <p className="entity__missing">No sessions recorded.</p>
            ) : (
              <div className="entity__table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Started</th>
                      <th>Duration</th>
                      <th>Proto</th>
                      <th>Cmds</th>
                      <th>Tool</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session) => (
                      <tr key={session.id}>
                        <td>
                          <a
                            className="entity__link"
                            href={routeHref({ kind: 'session', value: session.id })}
                          >
                            {session.id}
                          </a>
                        </td>
                        <td>{formatTimestamp(session.started_at)}</td>
                        <td>{formatDuration(session.duration_ms)}</td>
                        <td>{session.protocol ?? '—'}</td>
                        <td>{session.command_count}</td>
                        <td>{session.hassh ? <ToolLink hassh={session.hassh} /> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </EntitySection>
        </>
      )}
    </div>
  )
}
