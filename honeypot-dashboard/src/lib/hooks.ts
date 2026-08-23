import { useEffect, useRef, useState } from 'react'

/** Counts up to `target` with an ease-out curve. Skipped when motion is reduced. */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0)
  const start = useRef<number | null>(null)
  const from = useRef(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) {
      setValue(target)
      return
    }
    from.current = 0
    start.current = null
    let frame = 0
    const step = (now: number) => {
      if (start.current === null) start.current = now
      const progress = Math.min(1, (now - start.current) / durationMs)
      const eased = 1 - (1 - progress) ** 3
      setValue(Math.round(from.current + (target - from.current) * eased))
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  return value
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [])
  return reduced
}
