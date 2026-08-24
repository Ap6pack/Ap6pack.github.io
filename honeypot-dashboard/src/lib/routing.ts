// Hash routing. Entity pages get their own URL so an address, a session or a
// tool can be linked and cited from somewhere else.

export const SECTIONS = [
  'overview',
  'credentials',
  'activity',
  'geography',
  'attack',
  'ai-fallback',
  'samples',
  'explore',
  'about',
] as const

export type Section = (typeof SECTIONS)[number]

const ENTITY_KINDS = new Set(['ip', 'session', 'tool', 'search'])

export type Route =
  | { kind: 'section'; id: Section }
  | { kind: 'ip' | 'session' | 'tool' | 'search'; value: string }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')
  if (!path) return { kind: 'section', id: 'overview' }

  const slash = path.indexOf('/')
  if (slash > 0) {
    const kind = path.slice(0, slash)
    const value = decodeURIComponent(path.slice(slash + 1))
    if (ENTITY_KINDS.has(kind) && value) {
      return { kind: kind as 'ip' | 'session' | 'tool' | 'search', value }
    }
  }

  return SECTIONS.includes(path as Section)
    ? { kind: 'section', id: path as Section }
    : { kind: 'section', id: 'overview' }
}

export function routeHref(route: Route): string {
  return route.kind === 'section'
    ? `#${route.id}`
    : `#${route.kind}/${encodeURIComponent(route.value)}`
}

export function navigate(route: Route): void {
  window.location.hash = routeHref(route)
}
