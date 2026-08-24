import { useEffect, useState } from 'react'
import { EMPTY_STATS } from './lib/defaults'
import { parseHash, type Route, type Section } from './lib/routing'
import type {
  AttackData,
  FallbackEntry,
  GeoPoint,
  ReplaySession,
  Sample,
  Stats,
} from './lib/types'
import { useTheme } from './lib/useTheme'
import { About } from './components/About'
import { Activity } from './components/Activity'
import { AiFallback } from './components/AiFallback'
import { Attack } from './components/Attack'
import { Credentials } from './components/Credentials'
import { Explore } from './components/Explore'
import { Geography } from './components/Geography'
import { IpPage } from './components/IpPage'
import { Overview } from './components/Overview'
import { Samples } from './components/Samples'
import { SessionPage } from './components/SessionPage'
import { Sidebar } from './components/Sidebar'
import { ToolPage } from './components/ToolPage'

/** Fetch a published JSON file, ignoring failures so one bad file cannot blank the page. */
function loadJson<T>(path: string, onLoad: (value: T) => void): void {
  fetch(path, { cache: 'no-store' })
    .then((r) => r.json())
    .then(onLoad)
    .catch(() => {})
}

export function App() {
  const { theme, toggle } = useTheme()

  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [samples, setSamples] = useState<Sample[]>([])
  const [geo, setGeo] = useState<GeoPoint[]>([])
  const [fallback, setFallback] = useState<FallbackEntry[]>([])
  const [replay, setReplay] = useState<ReplaySession | null>(null)
  const [attack, setAttack] = useState<AttackData | null>(null)

  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  const section: Section = route.kind === 'section' ? route.id : 'explore'

  useEffect(() => {
    loadJson<Stats>('data/stats.json', setStats)
    loadJson<Sample[]>('data/manifest.json', setSamples)
    loadJson<GeoPoint[]>('data/geo.json', setGeo)
    loadJson<FallbackEntry[]>('data/llm_fallback.json', setFallback)
    // session_replay.json is a single session object, not a collection.
    loadJson<ReplaySession>('data/session_replay.json', setReplay)
    loadJson<AttackData>('data/attack_techniques.json', setAttack)
  }, [])

  useEffect(() => {
    function onHashChange() {
      setRoute(parseHash(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function goToSection(id: Section) {
    window.location.hash = id
    setRoute({ kind: 'section', id })
  }

  return (
    <div className="layout">
      <Sidebar active={section} onSelect={goToSection} theme={theme} onToggleTheme={toggle} />

      <main className="layout__content">
        {route.kind === 'ip' && <IpPage ip={route.value} />}
        {route.kind === 'session' && <SessionPage id={route.value} />}
        {route.kind === 'tool' && <ToolPage hassh={route.value} />}
        {route.kind === 'search' && <Explore initialTerm={route.value} />}

        {route.kind === 'section' && (
          <>
            {section === 'overview' && (
              <Overview stats={stats} session={replay} onNavigate={goToSection} />
            )}
            {section === 'credentials' && <Credentials stats={stats} />}
            {section === 'activity' && <Activity stats={stats} />}
            {section === 'geography' && <Geography points={geo} theme={theme} />}
            {section === 'attack' && <Attack data={attack} />}
            {section === 'ai-fallback' && <AiFallback entries={fallback} />}
            {section === 'samples' && <Samples samples={samples} />}
            {section === 'explore' && <Explore />}
            {section === 'about' && <About stats={stats} />}
          </>
        )}
      </main>
    </div>
  )
}
