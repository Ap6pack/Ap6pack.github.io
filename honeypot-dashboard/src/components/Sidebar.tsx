import { useEffect, useState, type ReactNode } from 'react'
import type { Section } from '../lib/routing'
import type { Theme } from '../lib/useTheme'

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    {children}
  </svg>
)

const ICONS: Record<Section, ReactNode> = {
  overview: svg(
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>,
  ),
  credentials: svg(
    <>
      <circle cx="8" cy="8" r="4" />
      <path d="M11 11 21 21M16 16l3-3M19 19l2-2" />
    </>,
  ),
  activity: svg(<path d="M3 12h4l2-7 4 14 2-7h6" />),
  geography: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </>,
  ),
  attack: svg(
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>,
  ),
  'ai-fallback': svg(
    <>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
      <circle cx="12" cy="12" r="3.5" />
    </>,
  ),
  samples: svg(
    <>
      <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4Z" />
      <path d="M9 12l2 2 4-4" />
    </>,
  ),
  explore: svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5 21 21" />
    </>,
  ),
  about: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01M11 12h1v5h1" />
    </>,
  ),
}

const NAV: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'credentials', label: 'Credentials' },
  { id: 'activity', label: 'Activity' },
  { id: 'geography', label: 'Geography' },
  { id: 'attack', label: 'ATT&CK' },
  { id: 'ai-fallback', label: 'AI Fallback' },
  { id: 'samples', label: 'Samples' },
  { id: 'explore', label: 'Explore' },
  { id: 'about', label: 'About' },
]

export function Sidebar({
  active,
  onSelect,
  theme,
  onToggleTheme,
}: {
  active: Section
  onSelect: (section: Section) => void
  theme: Theme
  onToggleTheme: () => void
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function select(section: Section) {
    onSelect(section)
    setOpen(false)
  }

  return (
    <>
      <div className="sidebar__topbar">
        <button
          type="button"
          className="sidebar__hamburger"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={open}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? <path d="M6 6l12 12M6 18 18 6" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        <span className="sidebar__topbar-title">Honeypot Data</span>
      </div>

      {open && <div className="sidebar__scrim" onClick={() => setOpen(false)} />}

      <nav
        className={`sidebar${open ? ' sidebar--open' : ''}`}
        aria-label="Dashboard sections"
      >
        <ul className="sidebar__list">
          {NAV.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`sidebar__item${active === item.id ? ' sidebar__item--active' : ''}`}
                onClick={() => select(item.id)}
                aria-current={active === item.id ? 'page' : undefined}
              >
                <span className="sidebar__icon">{ICONS[item.id]}</span>
                {item.label}
              </button>
            </li>
          ))}
        </ul>

        <button type="button" className="sidebar__theme" onClick={onToggleTheme}>
          {theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}
        </button>

        <a
          className="sidebar__coffee"
          href="https://buymeacoffee.com/ap6pack"
          target="_blank"
          rel="noopener"
        >
          ☕ Support this project
        </a>
      </nav>
    </>
  )
}
