import { useEffect, useState } from 'react'
import {
  getTool,
  getToolIps,
  getToolTopCommands,
  getToolTopCredentials,
  type FingerprintRow,
  type LabelCount,
} from '../lib/db'
import { formatTimestamp } from '../lib/format'
import { routeHref } from '../lib/routing'
import { BackLink, CountTable, EntitySection, Fact } from './entity'

export function ToolPage({ hassh }: { hassh: string }) {
  const [tool, setTool] = useState<FingerprintRow | null | 'loading'>('loading')
  const [ips, setIps] = useState<LabelCount[]>([])
  const [commands, setCommands] = useState<LabelCount[]>([])
  const [credentials, setCredentials] = useState<LabelCount[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setTool('loading')
    setError(null)

    Promise.all([
      getTool(hassh),
      getToolIps(hassh),
      getToolTopCommands(hassh),
      getToolTopCredentials(hassh),
    ])
      .then(([found, ipRows, commandRows, credentialRows]) => {
        if (cancelled) return
        setTool(found)
        setIps(ipRows)
        setCommands(commandRows)
        setCredentials(credentialRows)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [hassh])

  return (
    <div className="panel">
      <BackLink />
      <h1 className="entity__title">{hassh}</h1>
      <p className="entity__subtitle">
        SSH client fingerprint (HASSH). Derived from the algorithms this client offers during key
        exchange - the same tool keeps this fingerprint even when it moves to a different IP
        address.
      </p>

      {error && <p className="entity__missing">Could not load: {error}</p>}
      {tool === 'loading' && !error && <p className="entity__loading">Loading…</p>}
      {tool === null && !error && <p className="entity__missing">Unknown fingerprint.</p>}

      {tool && tool !== 'loading' && (
        <>
          <div className="entity__facts">
            <Fact label="Sessions" value={tool.sessions.toLocaleString()} />
            <Fact label="Distinct IPs" value={tool.distinct_ips.toLocaleString()} />
            <Fact label="First seen" value={formatTimestamp(tool.first_seen)} small />
            <Fact label="Last seen" value={formatTimestamp(tool.last_seen)} small />
          </div>

          {tool.distinct_ips > 1 && (
            <p className="entity__subtitle">
              This fingerprint has been seen from{' '}
              <strong>{tool.distinct_ips} different addresses</strong> — strong evidence they are
              the same tool or campaign rotating source IPs.
            </p>
          )}

          <EntitySection title="Addresses using this tool">
            {ips.length === 0 ? (
              <p className="entity__missing">None recorded.</p>
            ) : (
              <div className="entity__table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>IP</th>
                      <th>Sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ips.map((row) => (
                      <tr key={row.label}>
                        <td>
                          <a
                            className="entity__link"
                            href={routeHref({ kind: 'ip', value: row.label })}
                          >
                            {row.label}
                          </a>
                        </td>
                        <td>{row.n.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </EntitySection>

          <EntitySection title="Commands this tool runs">
            <CountTable rows={commands} keyLabel="Command" valueLabel="Times" />
          </EntitySection>

          <EntitySection title="Credentials this tool tries">
            <CountTable
              rows={credentials}
              keyLabel="Username"
              extraLabel="Password"
              valueLabel="Attempts"
            />
          </EntitySection>

          {tool.algorithms && (
            <EntitySection title="Offered algorithms">
              <pre className="entity__transcript" style={{ whiteSpace: 'pre-wrap' }}>
                {tool.algorithms.split(';').join('\n\n')}
              </pre>
            </EntitySection>
          )}
        </>
      )}
    </div>
  )
}
