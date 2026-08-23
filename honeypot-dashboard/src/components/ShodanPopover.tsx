import { useEffect, useRef, useState } from 'react'
import { formatTimestamp } from '../lib/format'
import type { GeoPoint } from '../lib/types'

interface ShodanData {
  ports: number[]
  vulns: string[]
  tags: string[]
  hostnames: string[]
}

type Lookup =
  | { status: 'loading' }
  | { status: 'ok'; data: ShodanData }
  | { status: 'not_found' }
  | { status: 'error' }

interface KevEntry {
  dateAdded: string
  knownRansomwareCampaignUse?: string
}

// CISA's Known Exploited Vulnerabilities catalogue, published alongside the
// dashboard data. Fetched once and shared by every popover.
let kevPromise: Promise<Record<string, KevEntry>> | null = null

function loadKev(): Promise<Record<string, KevEntry>> {
  kevPromise ??= fetch('data/kev.json')
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
  return kevPromise
}

export function ShodanPopover({
  x,
  y,
  point,
  onClose,
}: {
  x: number
  y: number
  point: GeoPoint
  onClose: () => void
}) {
  const [lookup, setLookup] = useState<Lookup>({ status: 'loading' })
  const [kev, setKev] = useState<Record<string, KevEntry>>({})
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadKev().then(setKev)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLookup({ status: 'loading' })

    fetch(`https://internetdb.shodan.io/${point.ip}`)
      .then((r) => {
        if (r.status === 404) return null
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
      .then((data: ShodanData | null) => {
        if (cancelled) return
        setLookup(data ? { status: 'ok', data } : { status: 'not_found' })
      })
      .catch(() => {
        if (!cancelled) setLookup({ status: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [point.ip])

  // Dismiss on Escape or an outside click. The mousedown listener is attached a
  // tick late so the click that opened this popover does not immediately close it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    const timer = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      clearTimeout(timer)
    }
  }, [onClose])

  const style = {
    left: Math.min(x, window.innerWidth - 320),
    top: Math.min(y, window.innerHeight - 260),
  }

  const abuseScore = point.abuse_score
  const confirmed = point.ai_agent_signal === 'confirmed'

  return (
    <div
      className="shodan-popover"
      style={style}
      ref={ref}
      role="dialog"
      aria-label={`Shodan lookup for ${point.ip}`}
    >
      <div className="shodan-popover__head">
        <code>{point.ip}</code>
        <button
          type="button"
          className="shodan-popover__close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {abuseScore !== undefined && (
        <div className="shodan-popover__section">
          <span className="shodan-popover__label">AbuseIPDB</span>
          <div className="shodan-popover__badges">
            <span
              className={`shodan-popover__badge ${
                abuseScore >= 50
                  ? 'shodan-popover__badge--kev'
                  : abuseScore > 0
                    ? 'shodan-popover__badge--tag'
                    : 'shodan-popover__badge--port'
              }`}
              title={`${point.abuse_reports ?? 0} abuse report(s) in the last 90 days${
                point.isp ? ` · ${point.isp}` : ''
              }`}
            >
              {abuseScore}% confidence
            </span>
            <span className="shodan-popover__meta">
              {point.abuse_reports ?? 0} report{point.abuse_reports === 1 ? '' : 's'}
              {point.isp ? ` · ${point.isp}` : ''}
            </span>
          </div>
          <p className="shodan-popover__meta">
            {point.usage_type && <>{point.usage_type} · </>}
            {point.domain && <>{point.domain} · </>}
            {point.tor_exit && <>Tor exit node · </>}
            {point.last_reported_at && <>last reported {formatTimestamp(point.last_reported_at)}</>}
          </p>
          <a
            className="shodan-popover__link"
            href={`https://www.abuseipdb.com/check/${point.ip}`}
            target="_blank"
            rel="noopener"
          >
            Full report on AbuseIPDB →
          </a>
        </div>
      )}

      {point.hassh && (
        <div className="shodan-popover__section">
          <span className="shodan-popover__label">SSH client fingerprint (HASSH)</span>
          <div className="shodan-popover__badges">
            <span
              className={`shodan-popover__badge ${
                (point.hassh_shared_count ?? 1) > 1
                  ? 'shodan-popover__badge--kev'
                  : 'shodan-popover__badge--port'
              }`}
              title="Derived from the SSH key-exchange algorithms this client offered - the same tool keeps this fingerprint even if it connects from a different IP later"
            >
              {point.hassh.slice(0, 12)}…
            </span>
          </div>
          {(point.hassh_shared_count ?? 1) > 1 && (
            <p className="shodan-popover__meta">
              Same fingerprint seen from {point.hassh_shared_count} distinct IPs - likely the
              same tool or campaign rotating source addresses.
            </p>
          )}
        </div>
      )}

      {point.ai_agent_signal && (
        <div className="shodan-popover__section">
          <span className="shodan-popover__label">AI agent signal</span>
          <div className="shodan-popover__badges">
            <span
              className={`shodan-popover__badge ${
                confirmed ? 'shodan-popover__badge--kev' : 'shodan-popover__badge--tag'
              }`}
              title={
                confirmed
                  ? 'This session complied with an instruction planted in the login banner - a human has no reason to type it, a scripted bot doesn’t parse banner text at all'
                  : 'Inter-command timing was faster and steadier than typical human typing but not the near-zero, no-variance gaps of a hardcoded script - a weaker, complementary signal'
              }
            >
              {confirmed ? 'Confirmed' : 'Suspected'}
            </span>
          </div>
          <p className="shodan-popover__meta">
            {confirmed
              ? 'Followed an instruction planted in the login banner - likely an LLM-driven attack agent, not a human or a simple script.'
              : 'Command timing pattern is consistent with an LLM-driven agent rather than a human or hardcoded script, though less certain than a confirmed match.'}
          </p>
        </div>
      )}

      {lookup.status === 'loading' && (
        <p className="shodan-popover__meta">Looking up on Shodan…</p>
      )}
      {lookup.status === 'error' && (
        <p className="shodan-popover__meta">Lookup failed - try again later.</p>
      )}
      {lookup.status === 'not_found' && (
        <p className="shodan-popover__meta">
          Not in Shodan's database (unscanned or no exposed services found).
        </p>
      )}

      {lookup.status === 'ok' && (
        <div className="shodan-popover__body">
          <div className="shodan-popover__section">
            <span className="shodan-popover__label">Open ports</span>
            <div className="shodan-popover__badges">
              {lookup.data.ports.length === 0 ? (
                <span className="shodan-popover__meta">none reported</span>
              ) : (
                lookup.data.ports.map((port) => (
                  <span key={port} className="shodan-popover__badge shodan-popover__badge--port">
                    {port}
                  </span>
                ))
              )}
            </div>
          </div>

          {lookup.data.vulns.length > 0 && (
            <div className="shodan-popover__section">
              <span className="shodan-popover__label">Known vulnerabilities</span>
              <div className="shodan-popover__badges">
                {lookup.data.vulns.map((cve) => {
                  const entry = kev[cve]
                  return (
                    <span
                      key={cve}
                      className={`shodan-popover__badge ${
                        entry ? 'shodan-popover__badge--kev' : 'shodan-popover__badge--vuln'
                      }`}
                      title={
                        entry
                          ? `CISA KEV: actively exploited in the wild (added ${entry.dateAdded})${
                              entry.knownRansomwareCampaignUse === 'Known'
                                ? ' - used in ransomware campaigns'
                                : ''
                            }`
                          : undefined
                      }
                    >
                      {entry && '⚠ '}
                      {cve}
                    </span>
                  )
                })}
              </div>
              {lookup.data.vulns.some((cve) => kev[cve]) && (
                <p className="shodan-popover__kev-note">
                  ⚠ = on CISA's Known Exploited Vulnerabilities list (actively exploited in the
                  wild, not just theoretical)
                </p>
              )}
            </div>
          )}

          {lookup.data.tags.length > 0 && (
            <div className="shodan-popover__section">
              <span className="shodan-popover__label">Tags</span>
              <div className="shodan-popover__badges">
                {lookup.data.tags.map((tag) => (
                  <span key={tag} className="shodan-popover__badge shodan-popover__badge--tag">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {lookup.data.hostnames.length > 0 && (
            <div className="shodan-popover__section">
              <span className="shodan-popover__label">Hostnames</span>
              <p className="shodan-popover__meta">{lookup.data.hostnames.join(', ')}</p>
            </div>
          )}

          <a
            className="shodan-popover__link"
            href={`https://www.shodan.io/host/${point.ip}`}
            target="_blank"
            rel="noopener"
          >
            Full report on Shodan →
          </a>
        </div>
      )}
    </div>
  )
}
