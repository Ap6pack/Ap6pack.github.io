import { useEffect, useState } from 'react'
import {
  PRESETS,
  customRange,
  describeLag,
  presetOutrunsData,
  presetRange,
  type Range,
} from '../lib/range'
import { getDataThrough } from '../lib/db'

interface Props {
  value: Range
  onChange: (range: Range) => void
}

/**
 * Time range control for Explore.
 *
 * The From/To fields are always visible rather than hidden behind a "Custom…"
 * toggle. Collapsed by default, they read as absent — the control looked like
 * presets only, and the date filtering nobody could find went unused.
 *
 * The freshness line below the presets exists because the queryable database
 * trails the 30-minute stats sync. A preset whose entire window falls after the
 * last indexed session is marked, so a legitimately empty result is
 * distinguishable from a broken filter.
 */
export function RangePicker({ value, onChange }: Props) {
  const [from, setFrom] = useState(value.from?.slice(0, 10) ?? '')
  const [to, setTo] = useState(value.to?.slice(0, 10) ?? '')
  const [dataThrough, setDataThrough] = useState<Date | null>(null)

  useEffect(() => {
    let cancelled = false
    getDataThrough().then((d) => {
      if (!cancelled) setDataThrough(d)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function updateCustom(nextFrom: string, nextTo: string) {
    setFrom(nextFrom)
    setTo(nextTo)
    if (nextFrom || nextTo) onChange(customRange(nextFrom, nextTo))
  }

  function selectPreset(key: Range['key']) {
    setFrom('')
    setTo('')
    onChange(presetRange(key))
  }

  const lag = describeLag(dataThrough)

  return (
    <div className="range-picker">
      <div className="range-picker__presets" role="group" aria-label="Time range">
        {PRESETS.map((preset) => {
          const empty = presetOutrunsData(preset, dataThrough)
          return (
            <button
              key={preset.key}
              type="button"
              className={
                'range-picker__btn' +
                (value.key === preset.key ? ' range-picker__btn--active' : '') +
                (empty ? ' range-picker__btn--empty' : '')
              }
              aria-pressed={value.key === preset.key}
              title={
                empty
                  ? 'The indexed data does not reach this far forward yet — this range will be empty'
                  : undefined
              }
              onClick={() => selectPreset(preset.key)}
            >
              {preset.label}
              {empty && <span aria-hidden="true"> ·</span>}
            </button>
          )
        })}
      </div>

      <div className="range-picker__custom">
        <label>
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => updateCustom(e.target.value, to)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => updateCustom(from, e.target.value)}
          />
        </label>
        {(from || to) && (
          <button
            type="button"
            className="range-picker__btn"
            onClick={() => selectPreset('all')}
          >
            Clear
          </button>
        )}
      </div>

      {dataThrough && (
        <p className="range-picker__freshness">
          Searchable data runs through{' '}
          <time dateTime={dataThrough.toISOString()}>
            {dataThrough.toLocaleString()}
          </time>
          {lag && ` · ${lag} behind the counters above, which update more often`}
        </p>
      )}
    </div>
  )
}
