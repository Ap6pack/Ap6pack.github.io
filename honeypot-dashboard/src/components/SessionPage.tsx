import { useEffect, useState } from 'react'
import {
  getSession,
  getSessionCommands,
  getSessionLogins,
  type CommandRow,
  type LoginRow,
  type SessionDetail,
} from '../lib/db'
import { formatDuration, formatTimestamp } from '../lib/format'
import { BackLink, EntitySection, Fact, IpLink, ToolLink } from './entity'

export function SessionPage({ id }: { id: string }) {
  const [session, setSession] = useState<SessionDetail | null | 'loading'>('loading')
  const [commands, setCommands] = useState<CommandRow[]>([])
  const [logins, setLogins] = useState<LoginRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSession('loading')
    setError(null)

    Promise.all([getSession(id), getSessionCommands(id), getSessionLogins(id)])
      .then(([found, commandRows, loginRows]) => {
        if (cancelled) return
        setSession(found)
        setCommands(commandRows)
        setLogins(loginRows)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [id])

  // Transcript times are shown relative to the first command in the session.
  const start = commands.length ? Date.parse(commands[0].ts) : 0

  return (
    <div className="panel">
      <BackLink />
      <h1 className="entity__title">{id}</h1>

      {error && <p className="entity__missing">Could not load: {error}</p>}
      {session === 'loading' && !error && <p className="entity__loading">Loading…</p>}
      {session === null && !error && <p className="entity__missing">No such session.</p>}

      {session && session !== 'loading' && (
        <>
          <p className="entity__subtitle">
            {session.protocol?.toUpperCase() ?? 'unknown'} session from{' '}
            <IpLink ip={session.ip} /> · {formatTimestamp(session.started_at)}
          </p>

          <div className="entity__facts">
            <Fact label="Duration" value={formatDuration(session.duration_ms)} />
            <Fact label="Commands" value={session.command_count.toLocaleString()} />
            <Fact
              label="Login"
              value={
                <span
                  className={`entity__badge ${
                    session.login_success ? 'entity__badge--ok' : 'entity__badge--fail'
                  }`}
                >
                  {session.login_success ? 'succeeded' : 'failed'}
                </span>
              }
            />
            {session.hassh && (
              <Fact label="Tool (HASSH)" value={<ToolLink hassh={session.hassh} />} small />
            )}
            {session.client && <Fact label="Client" value={session.client} small />}
            {session.src_port !== null && (
              <Fact label="Source port" value={session.src_port} small />
            )}
          </div>

          <EntitySection title="Login attempts">
            {logins.length === 0 ? (
              <p className="entity__missing">None recorded.</p>
            ) : (
              <div className="entity__table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Password</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logins.map((login, i) => (
                      <tr key={i}>
                        <td>
                          <code>{login.username === '' ? '(empty)' : login.username}</code>
                        </td>
                        <td>
                          <code>{login.password === '' ? '(empty)' : login.password}</code>
                        </td>
                        <td>
                          <span
                            className={`entity__badge ${
                              login.success ? 'entity__badge--ok' : 'entity__badge--fail'
                            }`}
                          >
                            {login.success ? 'success' : 'failed'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </EntitySection>

          <EntitySection title={`Command transcript (${commands.length})`}>
            {commands.length === 0 ? (
              <p className="entity__missing">This session ran no commands.</p>
            ) : (
              <pre className="entity__transcript">
                {commands.map((command, i) => {
                  const offset = ((Date.parse(command.ts) - start) / 1000).toFixed(1)
                  return (
                    <div className="entity__transcript-line" key={i}>
                      <span className="entity__transcript-time">+{offset.padStart(6)}s</span>
                      <span className="entity__transcript-cmd">$ {command.text}</span>
                    </div>
                  )
                })}
              </pre>
            )}
          </EntitySection>
        </>
      )}
    </div>
  )
}
