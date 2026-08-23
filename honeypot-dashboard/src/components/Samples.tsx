import { useState } from 'react'
import { formatBytes } from '../lib/format'
import { partitionSamples } from '../lib/samples'
import type { Sample } from '../lib/types'
import { EmptyState } from './EmptyState'

function SamplesTable({ samples }: { samples: Sample[] }) {
  return (
    <div className="samples-table-wrap">
      <table className="samples-table">
        <thead>
          <tr>
            <th>SHA-256</th>
            <th>Size</th>
            <th>VirusTotal</th>
            <th>Download</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((sample) => (
            <tr key={sample.sha256}>
              <td>
                <code>{sample.sha256}</code>
              </td>
              <td>{formatBytes(sample.size)}</td>
              <td>
                {sample.vt_total === undefined ? (
                  <span className="samples-table__vt-pending">not yet scanned</span>
                ) : (
                  <a
                    href={sample.vt_permalink}
                    target="_blank"
                    rel="noopener"
                    className="samples-table__vt-badge"
                    style={{
                      color:
                        (sample.vt_positives ?? 0) > 0
                          ? 'var(--status-critical)'
                          : 'var(--status-good)',
                    }}
                  >
                    {sample.vt_positives}/{sample.vt_total} detections
                  </a>
                )}
              </td>
              <td>
                <a
                  className="samples-table__download"
                  href={`data/samples/${encodeURIComponent(sample.zip)}`}
                >
                  Download .zip
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Captured files.
 *
 * The manifest is dominated by entries that carry no information: Cowrie logs a
 * download for transfers that resolved to a redirect and stored nothing, plus
 * the odd few-byte fragment. Listing those beside real captures buries the
 * handful of files that actually matter, so they are separated out and folded
 * away rather than dropped — the count is still true, it just is not the
 * headline.
 */
export function Samples({ samples }: { samples: Sample[] }) {
  const [showArtifacts, setShowArtifacts] = useState(false)
  const { captures, artifacts } = partitionSamples(samples)

  return (
    <div className="panel">
      <h1>Captured malware samples</h1>
      <p className="panel__intro">
        Password: <code>infected</code>. Handle in an isolated environment only.
      </p>

      {captures.length === 0 ? (
        <EmptyState message="No malware samples captured yet." />
      ) : (
        <SamplesTable samples={captures} />
      )}

      {artifacts.length > 0 && (
        <div className="samples-group">
          <p className="samples-group__note">
            {artifacts.length} further download {artifacts.length === 1 ? 'entry' : 'entries'}{' '}
            stored nothing worth keeping — transfers that resolved to a redirect, and
            fragments under 32 bytes.
          </p>
          <button
            type="button"
            className="samples-group__toggle"
            aria-expanded={showArtifacts}
            onClick={() => setShowArtifacts((open) => !open)}
          >
            {showArtifacts ? 'Hide' : 'Show'} empty download records
          </button>
          {showArtifacts && <SamplesTable samples={artifacts} />}
        </div>
      )}
    </div>
  )
}
