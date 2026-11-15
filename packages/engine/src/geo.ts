import { angleDiff } from './evaluate'
import { bearingDeg, distanceM } from './adapters'

export const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
export const compassOf = (deg: number): string => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Point a given distance and bearing from a start point (spherical; fine for a few km). */
export function offsetPoint(lat: number, lon: number, bearing: number, distM: number): { lat: number; lon: number } {
  const d = distM / 6_371_000
  const lat1 = rad(lat)
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(rad(bearing)))
  const lon2 = rad(lon) + Math.atan2(Math.sin(rad(bearing)) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: deg(lat2), lon: deg(lon2) }
}

/** Longitude/latitude to EPSG:5070 (CONUS Albers, NAD83), the grid the Cropland Data Layer uses. */
export function toAlbers(lat: number, lon: number): { x: number; y: number } {
  const a = 6378137
  const f = 1 / 298.257222101
  const e2 = 2 * f - f * f
  const e = Math.sqrt(e2)
  const q = (p: number) => {
    const s = Math.sin(p)
    return (1 - e2) * (s / (1 - e2 * s * s) - (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s)))
  }
  const m = (p: number) => Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) ** 2)
  const p1 = rad(29.5), p2 = rad(45.5), p0 = rad(23), l0 = rad(-96)
  const n = (m(p1) ** 2 - m(p2) ** 2) / (q(p2) - q(p1))
  const c = m(p1) ** 2 + n * q(p1)
  const rho = (p: number) => (a * Math.sqrt(c - n * q(p))) / n
  const theta = n * (rad(lon) - l0)
  return { x: rho(rad(lat)) * Math.sin(theta), y: rho(p0) - rho(rad(lat)) * Math.cos(theta) }
}

// ---------- Cropland Data Layer (USDA NASS CropScape) ----------

export function cdlUrl(year: number, lat: number, lon: number): string {
  const { x, y } = toAlbers(lat, lon)
  return `https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue?year=${year}&x=${x.toFixed(1)}&y=${y.toFixed(1)}`
}
export const parseCdl = (text: string): string | null => /category:\s*"([^"]+)"/.exec(text)?.[1] ?? null

// ---------- Pima County address points ----------

export interface AddressPoint { lat: number; lon: number; label: string; bearingDeg: number; distanceM: number }

export function pimaAddressUrl(lat: number, lon: number, radiusM: number): string {
  const dLat = radiusM / 111_000
  const dLon = radiusM / (111_000 * Math.cos(rad(lat)))
  const box = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map(v => v.toFixed(5)).join(',')
  return `https://gisdata.pima.gov/arcgis1/rest/services/GISOpenData/Addresses/MapServer/9/query?geometry=${box}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=OBJECTID,BLD_USE,STREET_NO,AD_STREET&returnGeometry=true&outSR=4326&f=json`
}

export function addressesFromPima(json: any, lat: number, lon: number, maxM: number): AddressPoint[] {
  const out: AddressPoint[] = []
  for (const f of json?.features ?? []) {
    const g = f.geometry
    if (typeof g?.x !== 'number' || typeof g?.y !== 'number') continue
    const d = distanceM(lat, lon, g.y, g.x)
    if (d > maxM) continue
    const a = f.attributes ?? {}
    out.push({ lat: g.y, lon: g.x, label: [a.STREET_NO, a.AD_STREET].filter(Boolean).join(' ') || 'Address', bearingDeg: bearingDeg(lat, lon, g.y, g.x), distanceM: Math.round(d) })
  }
  return out.sort((p, q) => p.distanceM - q.distanceM)
}

/** Points inside the buffer on the side the wind is blowing toward. Wind direction is where it blows from. */
export function downwindOf<T extends { bearingDeg: number; distanceM: number }>(points: T[], windFromDeg: number, bufferM: number, coneDeg = 45): T[] {
  const toward = (windFromDeg + 180) % 360
  return points.filter(p => p.distanceM <= bufferM && angleDiff(p.bearingDeg, toward) <= coneDeg)
}

// ---------- Elevation (USGS) ----------

export const elevationUrl = (lat: number, lon: number): string =>
  `https://epqs.nationalmap.gov/v1/json?x=${lon.toFixed(5)}&y=${lat.toFixed(5)}&units=Feet&wkid=4326`

/** Cold air drains downhill and pools: a block lower than its surroundings inverts first. */
export function isLowGround(centerFt: number, aroundFt: number[], marginFt = 3): boolean {
  if (!aroundFt.length) return false
  return centerFt < aroundFt.reduce((s, v) => s + v, 0) / aroundFt.length - marginFt
}

export interface Surroundings {
  blockId: string
  addresses: AddressPoint[]
  centerCrop: string | null
  crops: { dir: string; bearingDeg: number; lat: number; lon: number; category: string | null }[]
  elevationFt: number | null
  aroundFt: number[]
  lowGround: boolean | null
  fetchedMs: number
}

// ---------- Building outlines (OpenStreetMap) ----------

export interface Building { ring: [number, number][]; lat: number; lon: number; bearingDeg: number; distanceM: number; name: string | null; heightM?: number }

export const buildingsQuery = (lat: number, lon: number, radiusM: number): string =>
  `[out:json][timeout:40];way["building"](around:${radiusM},${lat},${lon});out tags geom;`

/** Outlines as [lon, lat] rings, with the centroid's bearing and distance from the block centre. */
export function buildingsFromOverpass(json: any, lat: number, lon: number): Building[] {
  const out: Building[] = []
  for (const e of json?.elements ?? []) {
    const g: { lat: number; lon: number }[] = e.geometry ?? []
    if (g.length < 4) continue
    const cLat = g.reduce((s, p) => s + p.lat, 0) / g.length
    const cLon = g.reduce((s, p) => s + p.lon, 0) / g.length
    out.push({
      ring: g.map(p => [p.lon, p.lat]), lat: cLat, lon: cLon, name: e.tags?.name ?? null,
      bearingDeg: bearingDeg(lat, lon, cLat, cLon), distanceM: Math.round(distanceM(lat, lon, cLat, cLon)),
    })
  }
  return out.sort((a, b) => a.distanceM - b.distanceM)
}

/** A building from a plain [lon, lat] ring, placed relative to a block centre. */
export function buildingFromRing(ring: [number, number][], lat: number, lon: number, heightM?: number): Building {
  const cLat = ring.reduce((s, p) => s + p[1], 0) / ring.length
  const cLon = ring.reduce((s, p) => s + p[0], 0) / ring.length
  const b: Building = { ring, lat: cLat, lon: cLon, name: null, bearingDeg: bearingDeg(lat, lon, cLat, cLon), distanceM: Math.round(distanceM(lat, lon, cLat, cLon)) }
  if (heightM && heightM > 0) b.heightM = Math.round(heightM * 10) / 10
  return b
}

/** Bing-style tile key for the tile containing a point, used by Microsoft's building footprint files. */
export function quadkey(lat: number, lon: number, zoom: number): string {
  const n = 2 ** zoom
  const x = Math.floor(((lon + 180) / 360) * n)
  const y = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n)
  let key = ''
  for (let i = zoom; i > 0; i--) {
    const mask = 1 << (i - 1)
    key += String((x & mask ? 1 : 0) + (y & mask ? 2 : 0))
  }
  return key
}
