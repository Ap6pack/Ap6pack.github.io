import { useState, type ReactNode } from 'react'
import { formatCount } from '../lib/format'
import { useCountUp } from '../lib/hooks'
import { EmptyState } from './EmptyState'

export type Pair = [string, number]

/** Chart with a table view behind a toggle, so the numbers stay readable. */
export function ChartCard({
  title,
  subtitle,
  chart,
  table,
}: {
  title: string
  subtitle?: string
  chart: ReactNode
  table: ReactNode
}) {
  const [showTable, setShowTable] = useState(false)
  return (
    <figure className="chart-card">
      <div className="chart-card__head">
        <div>
          <h3 className="chart-card__title">{title}</h3>
          {subtitle && <p className="chart-card__subtitle">{subtitle}</p>}
        </div>
        <button
          type="button"
          className="chart-card__toggle"
          aria-pressed={showTable}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? 'View chart' : 'View table'}
        </button>
      </div>
      <div className="chart-card__body">{showTable ? table : chart}</div>
    </figure>
  )
}

function Tooltip({
  x,
  y,
  visible,
  children,
}: {
  x: number
  y: number
  visible: boolean
  children: ReactNode
}) {
  if (!visible) return null
  return (
    <div className="viz-tooltip" style={{ left: x, top: y }} role="status">
      {children}
    </div>
  )
}

interface HoverState {
  x: number
  y: number
  label: string
  value: number
}

/** Horizontal bar chart. The value sits inside the bar once it is wide enough. */
export function HBarChart({ data, unit }: { data: Pair[]; unit: string }) {
  const [hover, setHover] = useState<HoverState | null>(null)

  if (data.length === 0) {
    return <EmptyState message="No data yet — check back after the next sync." />
  }

  const max = Math.max(...data.map(([, value]) => value))

  return (
    <div className="hbar-chart">
      {data.map(([label, value]) => {
        const pct = max > 0 ? (value / max) * 100 : 0
        const inside = pct > 22
        const show = (x: number, y: number) => setHover({ x, y, label, value })

        return (
          <div
            key={label}
            className="hbar-row"
            tabIndex={0}
            onPointerEnter={(e) => show(e.clientX, e.clientY)}
            onPointerMove={(e) => show(e.clientX, e.clientY)}
            onPointerLeave={() => setHover(null)}
            onFocus={(e) => {
              const box = e.currentTarget.getBoundingClientRect()
              show(box.left + 40, box.top)
            }}
            onBlur={() => setHover(null)}
          >
            <div className="hbar-row__label" title={label}>
              <code>{label === '' ? '(empty)' : label}</code>
            </div>
            <div className="hbar-row__track">
              <div className="hbar-row__fill" style={{ width: `${pct}%` }}>
                {inside && (
                  <span className="hbar-row__value hbar-row__value--inside">{value}</span>
                )}
              </div>
              {!inside && (
                <span className="hbar-row__value hbar-row__value--outside">{value}</span>
              )}
            </div>
          </div>
        )
      })}
      <Tooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={hover !== null}>
        <strong>{hover?.value}</strong> {unit} · {hover?.label === '' ? '(empty)' : hover?.label}
      </Tooltip>
    </div>
  )
}

export function DataTable({
  rows,
  keyLabel = 'Value',
  valueLabel,
}: {
  rows: Pair[]
  keyLabel?: string
  valueLabel: string
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>{keyLabel}</th>
          <th>{valueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={2}>No data yet</td>
          </tr>
        ) : (
          rows.map(([label, value]) => (
            <tr key={label}>
              <td>
                <code>{label === '' ? '(empty)' : label}</code>
              </td>
              <td>{value}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

export function StatTile({
  label,
  value,
  accent,
  icon,
  onClick,
}: {
  label: string
  value: number
  accent: string
  icon: ReactNode
  onClick?: () => void
}) {
  const animated = useCountUp(value)
  const content = (
    <>
      <div className="stat-tile__icon" style={{ color: accent }}>
        {icon}
      </div>
      <div className="stat-tile__value">{formatCount(animated)}</div>
      <div className="stat-tile__label">{label}</div>
    </>
  )

  return onClick ? (
    <button className="stat-tile" type="button" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="stat-tile">{content}</div>
  )
}
