import type { Sample } from './types'

/**
 * Anything below this is too small to be a payload. In practice the sub-32-byte
 * entries are things like a lone newline or the 9-byte string a probe echoes.
 */
const TRIVIAL_SIZE = 32

/**
 * Cowrie records a download entry even when the transfer resolved to a redirect
 * and nothing was stored. Those land in the manifest as 1-byte placeholders
 * with a `redir_` pseudo-hash and no VirusTotal result.
 */
function isRedirectStub(sample: Sample): boolean {
  return sample.sha256.startsWith('redir_')
}

export function isRealCapture(sample: Sample): boolean {
  return !isRedirectStub(sample) && sample.size >= TRIVIAL_SIZE
}

export interface PartitionedSamples {
  /** Actual captured files, most-detected first. */
  captures: Sample[]
  /** Redirect placeholders and sub-32-byte fragments. */
  artifacts: Sample[]
}

/**
 * Split the manifest so the page leads with what was actually caught.
 *
 * The raw manifest is mostly noise — redirect placeholders and tiny fragments
 * outnumber real captures by roughly four to one — which buries the handful of
 * genuinely malicious files under rows that carry no information.
 */
export function partitionSamples(samples: Sample[]): PartitionedSamples {
  const captures: Sample[] = []
  const artifacts: Sample[] = []

  for (const sample of samples) {
    if (isRealCapture(sample)) captures.push(sample)
    else artifacts.push(sample)
  }

  captures.sort((a, b) => {
    const detections = (b.vt_positives ?? -1) - (a.vt_positives ?? -1)
    return detections !== 0 ? detections : b.size - a.size
  })

  return { captures, artifacts }
}
