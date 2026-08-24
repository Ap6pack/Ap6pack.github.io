import type { AttackData } from '../lib/types'
import { ChartCard, DataTable, HBarChart, StatTile, type Pair } from './charts'
import { EmptyState } from './EmptyState'

const CATEGORICAL = [
  'var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)',
  'var(--cat-5)', 'var(--cat-6)', 'var(--cat-7)', 'var(--cat-8)',
]

/** Stable colour per tactic name, so a tactic keeps its colour between renders. */
function tacticColor(tactic: string): string {
  let sum = 0
  for (let i = 0; i < tactic.length; i++) sum = (sum + tactic.charCodeAt(i)) % CATEGORICAL.length
  return CATEGORICAL[sum]
}

export function Attack({ data }: { data: AttackData | null }) {
  const techniques = data?.techniques ?? []
  const matchRate =
    data && data.total_commands > 0
      ? Math.round((data.matched_commands / data.total_commands) * 100)
      : 0
  const rows: Pair[] = techniques.map((t) => [`${t.id} ${t.name}`, t.count])

  return (
    <div className="panel">
      <h1>ATT&amp;CK Mapping</h1>
      <p className="panel__intro">
        Every captured shell command is checked against a curated set of regex patterns tied to
        real MITRE ATT&amp;CK Enterprise techniques (IDs and names verified against MITRE's own
        STIX data, not guessed). This is a free, pattern-based approximation - not the LLM-driven
        classification commercial threat-intel platforms charge for - so treat matches as a rough
        signal, not a certified verdict.
      </p>

      {data && (
        <section className="kpi-row" style={{ marginBottom: '28px' }}>
          <StatTile
            label="Techniques observed"
            value={techniques.length}
            accent="var(--cat-1)"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="12" r="8" />
                <circle cx="12" cy="12" r="3.5" />
              </svg>
            }
          />
          <StatTile
            label="Commands tagged"
            value={data.matched_commands}
            accent="var(--cat-2)"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M4 12l5 5L20 6" />
              </svg>
            }
          />
          <StatTile
            label="Match rate"
            value={matchRate}
            accent="var(--cat-3)"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M3 12h4l2-7 4 14 2-7h6" />
              </svg>
            }
          />
        </section>
      )}

      {techniques.length === 0 ? (
        <EmptyState message="No commands have matched a known technique pattern yet - check back after the next sync." />
      ) : (
        <>
          <section className="charts-row charts-row--single">
            <ChartCard
              title="Commands by technique"
              subtitle="Count of captured commands - not attackers. One source repeating itself can dominate this; see distinct IPs below for how widespread each technique actually is"
              chart={<HBarChart data={rows} unit="commands" />}
              table={<DataTable rows={rows} keyLabel="Technique" valueLabel="Commands" />}
            />
          </section>

          <div className="attack-list">
            {techniques.map((technique) => (
              <div className="attack-entry" key={technique.id}>
                <div className="attack-entry__head">
                  <div>
                    <a
                      className="attack-entry__id"
                      href={technique.url}
                      target="_blank"
                      rel="noopener"
                      title="View this technique on attack.mitre.org"
                    >
                      {technique.id}
                    </a>
                    <span className="attack-entry__name">{technique.name}</span>
                  </div>
                  <span className="attack-entry__count">
                    {technique.count}× · {technique.distinct_ips} IP
                    {technique.distinct_ips === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="attack-entry__tactics">
                  {technique.tactics.map((tactic) => (
                    <span
                      key={tactic}
                      className="attack-entry__tactic"
                      style={{ color: tacticColor(tactic), borderColor: tacticColor(tactic) }}
                    >
                      {tactic.replace(/-/g, ' ')}
                    </span>
                  ))}
                </div>

                {technique.examples.length > 0 && (
                  <ul className="attack-entry__examples">
                    {technique.examples.slice(0, 3).map((example, i) => (
                      <li key={i}>
                        <code>{example}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
