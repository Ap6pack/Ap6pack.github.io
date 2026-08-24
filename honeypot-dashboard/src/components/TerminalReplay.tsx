import { useEffect, useRef, useState } from 'react'
import { formatTimestamp } from '../lib/format'
import { usePrefersReducedMotion } from '../lib/hooks'
import type { ReplaySession } from '../lib/types'

/** Longest pause replayed between two events, in seconds. */
const MAX_GAP = 1.2

/**
 * Replays a captured session keystroke by keystroke, preserving the attacker's
 * original timing but capping idle gaps so a session with a long pause in it
 * still plays at a watchable pace.
 */
export function TerminalReplay({ session }: { session: ReplaySession | null }) {
  const reducedMotion = usePrefersReducedMotion()
  const [lines, setLines] = useState<{ dir: string; text: string }[]>([])
  const [playing, setPlaying] = useState(false)
  const [replayNonce, setReplayNonce] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!session) return

    if (reducedMotion) {
      setLines(session.events.map((e) => ({ dir: e.dir, text: e.text })))
      setPlaying(false)
      return
    }

    setLines([])
    setPlaying(true)

    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    let elapsed = 0

    session.events.forEach((event, i) => {
      const previous = i === 0 ? event.t : session.events[i - 1].t
      elapsed += Math.min(Math.max(event.t - previous, 0), MAX_GAP)
      timers.push(
        setTimeout(() => {
          if (cancelled) return
          setLines((current) => [...current, { dir: event.dir, text: event.text }])
          if (i === session.events.length - 1) setPlaying(false)
        }, elapsed * 1000),
      )
    })

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [session, replayNonce, reducedMotion])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [lines])

  return (
    <div className="terminal-replay">
      <div className="terminal-replay__chrome">
        <div className="terminal-replay__dots">
          <span />
          <span />
          <span />
        </div>
        <span className="terminal-replay__title">
          {session ? `attacker@honeypot-01 — ${session.src_ip}` : 'honeypot-01 — listening'}
        </span>
        {session && !reducedMotion && (
          <button
            type="button"
            className="terminal-replay__replay-btn"
            onClick={() => setReplayNonce((n) => n + 1)}
            disabled={playing}
          >
            {playing ? 'Playing…' : '↻ Replay'}
          </button>
        )}
      </div>

      <div className="terminal-replay__body" ref={bodyRef}>
        {session ? (
          <>
            {lines.map((line, i) => (
              <span
                key={i}
                className={`terminal-replay__line--${line.dir === 'output' ? 'output' : 'input'}`}
              >
                {line.text}
              </span>
            ))}
            {playing && <span className="terminal-replay__cursor" />}
          </>
        ) : (
          <div className="terminal-replay__waiting">
            <span>Waiting for an attacker to do something interesting…</span>
            <span>
              ${' '}
              <span className="terminal-replay__cursor" />
            </span>
          </div>
        )}
      </div>

      {session && (
        <div className="terminal-replay__meta">
          Real captured session · {session.duration_ms}ms · {formatTimestamp(session.timestamp)}
        </div>
      )}
    </div>
  )
}
