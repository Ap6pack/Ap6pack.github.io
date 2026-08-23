import { formatTimestamp } from '../lib/format'
import type { Stats } from '../lib/types'

const DATA_FILES: { file: string; contents: React.ReactNode }[] = [
  {
    file: 'stats.json',
    contents:
      'Aggregate counts (events, sessions, logins, commands), top usernames/passwords, daily event volume.',
  },
  {
    file: 'geo.json',
    contents:
      'One entry per attacker IP: geolocation, event count, AbuseIPDB enrichment, SSH client HASSH fingerprint, AI-agent signal.',
  },
  {
    file: 'attack_techniques.json',
    contents: 'MITRE ATT&CK technique matches with counts, tactics, and example commands.',
  },
  {
    file: 'manifest.json',
    contents: (
      <>
        Captured file metadata: hash, size, VirusTotal verdict if scanned. Actual files are zipped
        (password <code>infected</code>) under <code>samples/</code>.
      </>
    ),
  },
  {
    file: 'llm_fallback.json',
    contents:
      'Commands with no scripted Cowrie response, and the AI-generated output shown instead.',
  },
  {
    file: 'session_replay.json',
    contents:
      'The single largest real captured session, as a timestamped event stream for keystroke-by-keystroke replay.',
  },
  {
    file: 'kev.json',
    contents:
      "Compact mirror of CISA's Known Exploited Vulnerabilities catalog, refreshed every 12 hours.",
  },
  {
    file: 'heartbeat.json',
    contents:
      'Timestamp of the last sync run, regardless of whether anything else changed - liveness signal only.',
  },
]

export function About({ stats }: { stats: Stats }) {
  return (
    <div className="panel">
      <h1>About &amp; Methodology</h1>
      <p className="panel__intro">
        What this is, how the data is collected, and - just as important - what it isn't. If
        you're citing numbers from this dashboard anywhere, read this first.
      </p>

      <section className="about-section">
        <h2>What this is</h2>
        <p>
          A single{' '}
          <a href="https://github.com/cowrie/cowrie" target="_blank" rel="noopener">
            Cowrie
          </a>{' '}
          SSH/Telnet honeypot running on one AWS EC2 instance (t4g.micro, us-east-1), exposed on
          both the standard ports (22, 23) and Cowrie's own default ports (2222, 2223). It's a
          medium-interaction honeypot: a scripted fake shell backed by a fake filesystem, with an
          LLM filling gaps for commands Cowrie doesn't already emulate. Nothing downloaded by an
          attacker is ever executed - files are captured and stored, not run.
        </p>
      </section>

      <section className="about-section">
        <h2>What counts as "attacker" data</h2>
        <p>
          Every event logged by Cowrie, except connections from a small, fixed set of
          admin/testing IPs used to maintain this project - those are filtered out of every stat,
          chart, and map on this site before publication. Everything else shown here reflects
          unsolicited traffic from the open internet.
        </p>
      </section>

      <section className="about-section">
        <h2>Single vantage point</h2>
        <p>
          This is one sensor, one cloud provider, one region. It sees what happens to reach this
          specific IP range - not a representative sample of global attack traffic. A large share
          of events on any given day can come from one or two high-volume automated sources; that
          skews aggregate stats (a technique count, a top command) toward whatever that one source
          happens to be doing, not necessarily what's most common across attackers generally.
          Where it matters, we try to distinguish "how many events" from "how many distinct IPs
          did this" - treat the latter as the more representative number.
        </p>
      </section>

      <section className="about-section">
        <h2>ATT&amp;CK tagging is pattern-based, not certified</h2>
        <p>
          Commands are matched against a curated set of regex patterns tied to real MITRE ATT&amp;CK
          Enterprise technique IDs (verified against MITRE's own STIX data). It's a free
          approximation of the kind of classification commercial threat-intel platforms sell - a
          rough signal worth a second look, not a certified verdict. False negatives (a real
          technique that doesn't match any pattern) are far more likely than false positives.
        </p>
      </section>

      <section className="about-section">
        <h2>Detecting AI-driven attackers</h2>
        <p>
          The login banner contains a planted instruction that a human has no reason to follow and
          a simple scripted bot doesn't parse at all - only an attacker running an LLM agent that
          treats terminal text as context to act on would comply. Sessions that do are flagged as
          a confirmed AI-agent signal; sessions with command timing that's faster and steadier
          than typical human typing (but not the zero-variance pace of a hardcoded script) get a
          weaker "suspected" signal. Technique adapted from Palisade Research's{' '}
          <a href="https://arxiv.org/abs/2410.13919" target="_blank" rel="noopener">
            LLM Agent Honeypot
          </a>
          . The exact trigger text isn't published here for the obvious reason.
        </p>
      </section>

      <section className="about-section">
        <h2>What we do with attacker IPs</h2>
        <p>
          IPs with real login attempts are reported to{' '}
          <a href="https://www.abuseipdb.com" target="_blank" rel="noopener">
            AbuseIPDB
          </a>{' '}
          and{' '}
          <a href="https://www.dshield.org" target="_blank" rel="noopener">
            SANS ISC/DShield
          </a>{' '}
          - two community threat-intel databases this project only ever used to consume from until
          recently. This honeypot existing only to look things up and never contribute back didn't
          sit right, so now it reports too.
        </p>
      </section>

      <section className="about-section">
        <h2>Freshness &amp; limitations</h2>
        <ul className="about-list">
          <li>Data refreshes automatically about every 30 minutes.</li>
          <li>
            Malware "samples" include failed/empty download attempts, not just successful payloads
            - check the file size before assuming a capture is a real binary.
          </li>
          <li>
            Credentials and commands shown are exactly what attackers typed - unfiltered,
            including anything offensive or nonsensical.
          </li>
          <li>
            This project is unaffiliated with any employer, vendor, or organization. It's a
            personal research project.
          </li>
        </ul>
        {stats.first_event && (
          <p className="about-meta">
            Continuous data collection since {formatTimestamp(stats.first_event)}. Last synced{' '}
            {stats.generated_at ? formatTimestamp(stats.generated_at) : 'recently'}.
          </p>
        )}
      </section>

      <section className="about-section">
        <h2>Data files</h2>
        <p>
          Everything on this dashboard is generated from plain, static JSON files under{' '}
          <code>data/</code> - no auth, no CORS restrictions, refreshed roughly every 30 minutes.
          Fetch them directly if you want the raw data. <strong>No stability guarantee</strong> -
          field names and structure can change without notice, this isn't a versioned API.
        </p>
        <div className="about-table-wrap">
          <table className="data-table about-api-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Contents</th>
              </tr>
            </thead>
            <tbody>
              {DATA_FILES.map((row) => (
                <tr key={row.file}>
                  <td>
                    <code>{row.file}</code>
                  </td>
                  <td>{row.contents}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="about-section">
        <h2>Built by</h2>
        <p>
          <a href="https://github.com/Ap6pack" target="_blank" rel="noopener">
            Adam Rhys Heaton
          </a>
          . Every chart on this site is generated from the same plain <code>data/*.json</code>{' '}
          files this dashboard fetches - open your browser's network tab to see exactly what's
          being read.
        </p>
      </section>
    </div>
  )
}
