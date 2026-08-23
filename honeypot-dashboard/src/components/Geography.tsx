import type { GeoPoint } from '../lib/types'
import type { Theme } from '../lib/useTheme'
import { ChartCard, DataTable, HBarChart, type Pair } from './charts'
import { WorldMap } from './WorldMap'

/** Roll per-IP points up into a country leaderboard. */
function byCountry(points: GeoPoint[]): Pair[] {
  const totals = new Map<string, number>()
  for (const point of points) {
    const key = point.country ?? 'unknown'
    totals.set(key, (totals.get(key) ?? 0) + point.count)
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
}

export function Geography({ points, theme }: { points: GeoPoint[]; theme: Theme }) {
  const countries = byCountry(points)
  const ipRows: Pair[] = points.map((p) => [`${p.ip} (${p.country})`, p.count])

  return (
    <div className="panel">
      <h1>Geography</h1>
      <p className="panel__intro">
        Source locations of attacker IPs against this honeypot, resolved via IP geolocation.
      </p>

      <section className="charts-row charts-row--single">
        <ChartCard
          title="Attacker source locations"
          subtitle="Each dot is a unique attacker IP, sized by event count"
          chart={<WorldMap points={points} theme={theme} />}
          table={<DataTable rows={ipRows} keyLabel="IP (country)" valueLabel="Events" />}
        />
      </section>

      <section className="charts-row charts-row--single">
        <ChartCard
          title="Top countries by attack volume"
          subtitle="Attacker events grouped by country"
          chart={<HBarChart data={countries} unit="events" />}
          table={<DataTable rows={countries} keyLabel="Country" valueLabel="Events" />}
        />
      </section>
    </div>
  )
}
