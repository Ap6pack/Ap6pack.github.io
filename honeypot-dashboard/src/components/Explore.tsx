import { useEffect, useRef, useState } from 'react'
import {
  countResults,
  getTransferStats,
  listTools,
  search,
  type SearchResults,
  type ToolListRow,
  type TransferStats,
} from '../lib/db'
import { formatTimestamp } from '../lib/format'
import { ALL_TIME, describeRange, type Range } from '../lib/range'
import { navigate, routeHref } from '../lib/routing'
import { EntitySection, ToolLink } from './entity'
import { RangePicker } from './RangePicker'

type Status = 'idle' | 'loading' | 'ok' | 'error'
type ToolsState = 'loading' | 'error' | ToolListRow[]

/** Typing settles for this long before a query is issued. */
const DEBOUNCE_MS = 220

export function Explore({ initialTerm = '' }: { initialTerm?: string }) {
  const [term, setTerm] = useState(initialTerm)
  const [range, setRange] = useState<Range>(ALL_TIME)
  const [results, setResults] = useState<SearchResults | null>(null)
  const [tools, setTools] = useState<ToolsState>('loading')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const [transfer, setTransfer] = useState<TransferStats | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    setTerm(initialTerm)
  }, [initialTerm])

  useEffect(() => {
    listTools()
      .then(setTools)
      .catch(() => setTools('error'))
  }, [])

  useEffect(() => {
    const trimmed = term.trim()
    if (trimmed.length < 2) {
      setResults(null)
      setStatus('idle')
      return
    }

    const id = ++requestId.current
    setStatus('loading')

    const timer = setTimeout(() => {
      search(trimmed, range)
        .then((found) => {
          if (id !== requestId.current) return
          setResults(found)
          setStatus('ok')
          getTransferStats().then(setTransfer)
        })
        .catch((err: unknown) => {
          if (id !== requestId.current) return
          setError(err instanceof Error ? err.message : String(err))
          setStatus('error')
        })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [term, range])

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = term.trim()
    if (trimmed) navigate({ kind: 'search', value: trimmed })
  }

  const matches = results ? countResults(results) : 0

  return (
    <div className="panel">
      <h1>Explore</h1>
      <p className="panel__intro">
        Search every session, command and credential this honeypot has recorded. Queries run
        against a SQLite database in your browser — only the pages each query touches are fetched,
        so searching a 20 MB dataset costs a few KB.
      </p>

      <form className="explore__search" onSubmit={onSubmit} role="search">
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search an IP, command, username, password or session id…"
          aria-label="Search the honeypot database"
          autoComplete="off"
          spellCheck={false}
        />
      </form>

      <div className="explore__range">
        <RangePicker value={range} onChange={setRange} />
      </div>

      {status === 'error' && <p className="entity__missing">Search failed: {error}</p>}
      {status === 'loading' && <p className="entity__loading">Searching…</p>}

      {status === 'ok' && results && (
        <>
          <p className="explore__meta">
            {matches} match{matches === 1 ? '' : 'es'} for <code>{term.trim()}</code> ·{' '}
            {describeRange(range)}
            {transfer &&
              ` · fetched ${(transfer.fetched / 1024).toFixed(0)} KB in ${transfer.requests} requests`}
          </p>

          {matches === 0 && (
            <p className="entity__missing">
              Nothing matched. Try a partial IP, a command fragment like <code>wget</code>, or a
              username.
            </p>
          )}

          {results.ips.length > 0 && (
            <EntitySection title={`Addresses (${results.ips.length})`}>
              <div className="entity__table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>IP</th>
                      <th>Country</th>
                      <th>Sessions</th>
                      <th>Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.ips.map((row) => (
                      <tr key={row.ip}>
                        <td>
                          <a
                            className="entity__link"
                            href={routeHref({ kind: 'ip', value: row.ip })}
                          >
                            {row.ip}
                          </a>
                        </td>
                        <td>{row.country ?? '—'}</td>
                        <td>{row.sessions.toLocaleString()}</td>
                        <td>{formatTimestamp(row.last_seen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </EntitySection>
          )}

          {results.commands.length > 0 && (
            <EntitySection title={`Commands (${results.commands.length})`}>
              <div className="entity__table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Command</th>
                      <th>Times run</th>
                      <th>Distinct IPs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.commands.map((row, i) => (
                      <tr key={`${row.text}-${i}`}>
                        <td>
                          <code>{row.text === '' ? '(empty)' : row.text}</code>
                        </td>
                        <td>{row.uses.toLocaleString()}</td>
                        <td>{row.distinct_ips.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </EntitySection>
          )}

          {results.credentials.length > 0 && (
            <EntitySection title={`Credentials (${results.credentials.length})`}>
              <div className="entity__table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Password</th>
                      <th>Attempts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.credentials.map((row, i) => (
                      <tr key={`${row.username}-${row.password}-${i}`}>
                        <td>
                          <code>{row.username === '' ? '(empty)' : row.username}</code>
                        </td>
                        <td>
                          <code>{row.password === '' ? '(empty)' : row.password}</code>
                        </td>
                        <td>{row.attempts.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </EntitySection>
          )}

          {results.sessions.length > 0 && (
            <EntitySection title={`Sessions (${results.sessions.length})`}>
              <div className="entity__table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>IP</th>
                      <th>Started</th>
                      <th>Commands</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.sessions.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <a
                            className="entity__link"
                            href={routeHref({ kind: 'session', value: row.id })}
                          >
                            {row.id}
                          </a>
                        </td>
                        <td>
                          <a
                            className="entity__link"
                            href={routeHref({ kind: 'ip', value: row.ip })}
                          >
                            {row.ip}
                          </a>
                        </td>
                        <td>{formatTimestamp(row.started_at)}</td>
                        <td>{row.command_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </EntitySection>
          )}
        </>
      )}

      {status === 'idle' && (
        <EntitySection
          title={`Attacker tools${Array.isArray(tools) ? ` (${tools.length})` : ''}`}
        >
          <p className="explore__hint">
            Every session is fingerprinted by the SSH client that made it. A handful of tools
            account for almost all traffic — and the same tool keeps its fingerprint across
            different IP addresses.
          </p>

          {tools === 'loading' ? (
            <p className="entity__loading">Loading database…</p>
          ) : tools === 'error' ? (
            <p className="entity__missing">
              The queryable database could not be loaded. The charts on the other pages are
              unaffected.
            </p>
          ) : tools.length === 0 ? (
            <p className="entity__missing">No fingerprinted sessions yet.</p>
          ) : (
            <div className="entity__table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Fingerprint</th>
                    <th>Sessions</th>
                    <th>Distinct IPs</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {tools.map((tool) => (
                    <tr key={tool.hassh}>
                      <td>
                        <ToolLink hassh={tool.hassh} />
                      </td>
                      <td>{tool.sessions.toLocaleString()}</td>
                      <td>{tool.distinct_ips.toLocaleString()}</td>
                      <td>{formatTimestamp(tool.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </EntitySection>
      )}
    </div>
  )
}
