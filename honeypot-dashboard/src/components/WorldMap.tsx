import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import type { GeoPoint } from '../lib/types'
import type { Theme } from '../lib/useTheme'
import { EmptyState } from './EmptyState'
import { ShodanPopover } from './ShodanPopover'

const TILES: Record<Theme, string> = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
}

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

/** A pulsing dot sized by how much traffic came from that location. */
function markerIcon(radius: number) {
  const size = radius * 2
  return L.divIcon({
    className: 'world-map__marker-wrap',
    html: `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${radius}" cy="${radius}" r="${radius - 1}" class="world-map__pulse" />
        <circle cx="${radius}" cy="${radius}" r="${radius - 1}" class="world-map__dot" />
      </svg>`,
    iconSize: [size, size],
    iconAnchor: [radius, radius],
  })
}

interface PopoverState {
  x: number
  y: number
  point: GeoPoint
}

export function WorldMap({ points, theme }: { points: GeoPoint[]; theme: Theme }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)

  // Create the map once; React never re-renders into this subtree.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center: [20, 10],
      zoom: 2,
      minZoom: 1,
      maxZoom: 12,
      worldCopyJump: true,
    })

    tileRef.current = L.tileLayer(TILES[theme], {
      attribution: ATTRIBUTION,
      maxZoom: 20,
    }).addTo(map)

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    })
    map.addLayer(cluster)

    mapRef.current = map
    clusterRef.current = cluster
    requestAnimationFrame(() => map.invalidateSize())

    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      clusterRef.current = null
      tileRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap basemap when the theme changes, without rebuilding the map.
  useEffect(() => {
    tileRef.current?.setUrl(TILES[theme])
  }, [theme])

  useEffect(() => {
    const cluster = clusterRef.current
    if (!cluster) return
    cluster.clearLayers()
    if (points.length === 0) return

    const busiest = Math.max(...points.map((p) => p.count), 1)

    for (const point of points) {
      // Square-root scaling so one very loud host does not swamp the rest.
      const radius = 5 + Math.sqrt(point.count / busiest) * 10
      const marker = L.marker([point.lat, point.lon], { icon: markerIcon(radius) })
      marker.on('click', (event) => {
        const original = event.originalEvent as MouseEvent
        setPopover({ x: original.clientX, y: original.clientY, point })
      })
      cluster.addLayer(marker)
    }
  }, [points])

  return (
    <div className="world-map">
      {points.length === 0 && (
        <EmptyState message="No geolocated attacker IPs yet - check back after the next sync." />
      )}
      <div
        ref={containerRef}
        className="world-map__leaflet"
        style={points.length === 0 ? { display: 'none' } : undefined}
      />
      {popover && (
        <ShodanPopover
          x={popover.x}
          y={popover.y}
          point={popover.point}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  )
}
