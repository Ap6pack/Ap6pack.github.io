import type { ReactNode } from 'react'
import { routeHref } from '../lib/routing'
import type { LabelCount } from '../lib/db'

export function BackLink({ label = '← Back to Explore' }: { label?: string }) {
  return (
    <a className="entity__back" href={routeHref({ kind: 'section', id: 'explore' })}>
      {label}
    </a>
  )
}

export function Fact({
  label,
  value,
  small,
}: {
  label: string
  value: ReactNode
  small?: boolean
}) {
  return (
    <div className="entity__fact">
      <span className="entity__fact-label">{label}</span>
      <span className={`entity__fact-value${small ? ' entity__fact-value--sm' : ''}`}>
        {value}
      </span>
    </div>
  )
}

export function EntitySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="entity__section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function IpLink({ ip }: { ip: string }) {
  return (
    <a className="entity__link" href={routeHref({ kind: 'ip', value: ip })}>
      {ip}
    </a>
  )
}

export function SessionLink({ id }: { id: string }) {
  return (
    <a className="entity__link" href={routeHref({ kind: 'session', value: id })}>
      {id}
    </a>
  )
}

export function ToolLink({ hassh, truncate = true }: { hassh: string; truncate?: boolean }) {
  return (
    <a className="entity__link" href={routeHref({ kind: 'tool', value: hassh })}>
      {truncate ? `${hassh.slice(0, 12)}…` : hassh}
    </a>
  )
}

export function CountTable({
  rows,
  keyLabel,
  extraLabel,
  valueLabel,
  mono = true,
}: {
  rows: LabelCount[]
  keyLabel: string
  extraLabel?: string
  valueLabel: string
  mono?: boolean
}) {
  if (rows.length === 0) return <p className="entity__missing">None recorded.</p>

  return (
    <div className="entity__table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>{keyLabel}</th>
            {extraLabel && <th>{extraLabel}</th>}
            <th>{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.label}-${row.extra ?? ''}-${i}`}>
              <td>{mono ? <code>{row.label === '' ? '(empty)' : row.label}</code> : row.label}</td>
              {extraLabel && (
                <td>
                  <code>{row.extra === '' ? '(empty)' : row.extra}</code>
                </td>
              )}
              <td>{row.n.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
