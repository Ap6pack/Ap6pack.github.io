import type { Stats } from '../lib/types'
import { ChartCard, DataTable, HBarChart } from './charts'

export function Credentials({ stats }: { stats: Stats }) {
  return (
    <div className="panel">
      <h1>Credentials</h1>
      <p className="panel__intro">
        Login attempts against the fake SSH service, broken down by username and password.
      </p>
      <section className="charts-row">
        <ChartCard
          title="Top usernames tried"
          subtitle="Credential-stuffing attempts against the fake SSH service"
          chart={<HBarChart data={stats.top_usernames} unit="attempts" />}
          table={
            <DataTable rows={stats.top_usernames} keyLabel="Username" valueLabel="Attempts" />
          }
        />
        <ChartCard
          title="Top passwords tried"
          subtitle="Same login attempts, keyed by password"
          chart={<HBarChart data={stats.top_passwords} unit="attempts" />}
          table={
            <DataTable rows={stats.top_passwords} keyLabel="Password" valueLabel="Attempts" />
          }
        />
      </section>
    </div>
  )
}
