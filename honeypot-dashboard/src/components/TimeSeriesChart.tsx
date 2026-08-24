import { useRef, useState } from 'react'
import { EmptyState } from './EmptyState'

const WIDTH = 720
const HEIGHT = 220
const LEFT = 40
const TOP = 12
const BASELINE = 196
const PLOT_WIDTH = 668
const PLOT_HEIGHT = 184

export interface DailyPoint {
  date: string
  count: number
}

export function TimeSeriesChart({ data }: { data: DailyPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const [tip, setTip] = useState({ x: 0, y: 0 })

  if (data.length === 0) {
    return (
      <EmptyState message="No daily activity yet — the time series fills in once the honeypot has a few days of traffic." />
    )
  }

  const max = Math.max(...data.map((d) => d.count), 1)
  const xAt = (i: number) =>
    LEFT + (data.length === 1 ? PLOT_WIDTH / 2 : (i / (data.length - 1)) * PLOT_WIDTH)
  const yAt = (count: number) => BASELINE - (count / max) * PLOT_HEIGHT

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(d.count)}`).join(' ')
  const area = `${line} L ${xAt(data.length - 1)} ${BASELINE} L ${xAt(0)} ${BASELINE} Z`
  const ticks = Array.from({ length: 5 }, (_, i) => Math.round((max / 4) * i))

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return
    const box = svg.getBoundingClientRect()
    const localX = ((event.clientX - box.left) / box.width) * WIDTH
    const ratio = data.length === 1 ? 0 : (localX - LEFT) / PLOT_WIDTH
    const index = Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1))))
    setActive(index)
    setTip({ x: event.clientX, y: box.top })
  }

  return (
    <div className="timeseries-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="timeseries-chart__svg"
        onPointerMove={handleMove}
        onPointerLeave={() => setActive(null)}
        role="img"
        aria-label="Daily event volume"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={LEFT}
              x2={708}
              y1={yAt(tick)}
              y2={yAt(tick)}
              className="timeseries-chart__grid"
            />
            <text
              x={32}
              y={yAt(tick) + 3}
              textAnchor="end"
              className="timeseries-chart__axis-label"
            >
              {tick}
            </text>
          </g>
        ))}

        <path d={area} className="timeseries-chart__area" />
        <path d={line} className="timeseries-chart__line" />

        {data.map((point, i) =>
          i !== 0 && i !== data.length - 1 && i !== active ? null : (
            <circle
              key={point.date}
              cx={xAt(i)}
              cy={yAt(point.count)}
              r="4"
              className="timeseries-chart__dot"
            />
          ),
        )}

        {active !== null && (
          <line
            x1={xAt(active)}
            x2={xAt(active)}
            y1={TOP}
            y2={BASELINE}
            className="timeseries-chart__crosshair"
          />
        )}

        <text x={xAt(0)} y={216} textAnchor="start" className="timeseries-chart__axis-label">
          {data[0].date}
        </text>
        <text
          x={xAt(data.length - 1)}
          y={216}
          textAnchor="end"
          className="timeseries-chart__axis-label"
        >
          {data[data.length - 1].date}
        </text>
      </svg>

      {active !== null && (
        <div className="viz-tooltip" style={{ left: tip.x, top: tip.y }} role="status">
          <strong>{data[active].count}</strong> events · {data[active].date}
        </div>
      )}
    </div>
  )
}
