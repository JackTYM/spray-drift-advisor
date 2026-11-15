import { compassOf, offsetPoint } from './geo'

/**
 * What the ground around a field says about its microclimate.
 * On clear, calm nights cold air drains downhill and pools in low places, so a field that sits
 * below its surroundings inverts earlier and more strongly than the regional forecast suggests.
 */

const RINGS_M = [500, 2000, 6000]
const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315]

/** The points to look up: the field centre, then eight points on each ring. */
export function terrainPoints(lat: number, lon: number): { lat: number; lon: number }[] {
  return [{ lat, lon }, ...RINGS_M.flatMap(r => BEARINGS.map(b => offsetPoint(lat, lon, b, r)))]
}

export interface Terrain {
  elevM: number
  /** Field elevation minus the average around it, at each ring distance. Negative means the field is lower. */
  relief500M: number
  relief2kmM: number
  relief6kmM: number
  slopePct: number
  /** Compass direction the ground falls toward: where cold air would drain. */
  drainsToward: string
  /** 0 to 1: how strongly cold air is expected to collect here. */
  coldPool: number
  kind: 'low ground' | 'valley floor' | 'slope' | 'high ground' | 'open flat'
  summary: string
}

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)
const r1 = (n: number) => Math.round(n * 10) / 10
const ft = (m: number) => Math.round(Math.abs(m) * 3.281)

/** Elevations in metres, in the order terrainPoints() returns them. */
export function analyzeTerrain(elevs: number[]): Terrain {
  const elevM = elevs[0]!
  const ring = (i: number) => elevs.slice(1 + i * 8, 9 + i * 8)
  const [near, mid, far] = [ring(0), ring(1), ring(2)]
  const relief500M = r1(elevM - mean(near)), relief2kmM = r1(elevM - mean(mid)), relief6kmM = r1(elevM - mean(far))

  // Slope and drainage direction from the 2 km ring: the steepest fall across the field.
  let best = 0, bestBearing = 0
  for (let i = 0; i < 8; i++) {
    const fall = (mid[(i + 4) % 8]! - mid[i]!) / 4000
    if (fall > best) { best = fall; bestBearing = BEARINGS[i]! }
  }
  const slopePct = r1(best * 100)

  // A dip of 12 m against the nearby ground, or 40 m against the wider valley, counts as fully pooling.
  const coldPool = Math.round(clamp(Math.max(-relief2kmM / 12, -relief6kmM / 40, -relief500M / 6), 0, 1) * 100) / 100
  const kind: Terrain['kind'] = coldPool >= 0.5 ? (-relief6kmM / 40 >= -relief2kmM / 12 ? 'valley floor' : 'low ground')
    : relief2kmM > 8 ? 'high ground' : slopePct >= 0.7 ? 'slope' : 'open flat'

  const where = kind === 'valley floor' ? `sits about ${ft(relief6kmM)} ft below the land within 6 km, on a valley floor`
    : kind === 'low ground' ? `sits about ${ft(relief2kmM)} ft below the land within 2 km`
    : kind === 'high ground' ? `sits about ${ft(relief2kmM)} ft above the land within 2 km`
    : kind === 'slope' ? `is on ground that falls ${slopePct}% toward the ${compassOf(bestBearing)}`
    : 'is on open, nearly level ground'
  const effect = coldPool >= 0.5 ? 'Cold air drains here and collects on clear, calm nights, so inversions form earlier and are stronger than the regional forecast.'
    : kind === 'high ground' ? 'Cold air drains away from it, so inversions are weaker and form later than on the valley floor.'
    : kind === 'slope' ? `Cold air moves across it toward the ${compassOf(bestBearing)} at night instead of collecting, so inversions are moderate.`
    : 'Nothing in the terrain sets it apart from the regional forecast.'
  return { elevM: Math.round(elevM), relief500M, relief2kmM, relief6kmM, slopePct, drainsToward: compassOf(bestBearing), coldPool, kind, summary: `This field ${where}. ${effect}` }
}
