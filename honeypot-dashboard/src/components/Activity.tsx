import type { Stats } from '../lib/types'
import { ChartCard, DataTable, type Pair } from './charts'
import { TimeSeriesChart } from './TimeSeriesChart'

export function Activity({ stats }: { stats: Stats }) {
  const daily = stats.daily_events ?? []
  const rows: Pair[] = daily.map((d) => [d.date, d.count])

  return (
    <div className="panel">
      <h1>Activity</h1>
      <p className="panel__intro">
        Overall Cowrie event volume over time - connections, logins, and commands combined.
      </p>
      <section className="charts-row charts-row--single">
        <ChartCard
          title="Daily event volume"
          subtitle="All Cowrie events (connections, logins, commands) per day"
          chart={<TimeSeriesChart data={daily} />}
          table={<DataTable rows={rows} keyLabel="Date" valueLabel="Events" />}
        />
      </section>
    </div>
  )
}
