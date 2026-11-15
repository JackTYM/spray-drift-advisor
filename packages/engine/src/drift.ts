import { explain, inversionTopFt } from './explain'
import { pointInPolygon, randomPointIn, squareOutline, type Pt } from './field'
import { mulberry32 } from './tower'
import type { Job, Reading } from './types'

/**
 * Droplet drift model: a random walk in a wind profile (a Lagrangian particle model).
 * Each droplet is carried by the wind at its height, settles at a speed set by its size, and is
 * jostled by turbulence whose strength falls as the Richardson number rises.
 * It compares conditions with each other. It is not a prediction of deposition.
 * Units: metres, seconds. x is east, y is north, z is up, origin at the block centre.
 */

const MPH = 0.44704
const FT = 0.3048
export const CANOPY_M = 18 * FT
export const LOW_M = 15 * FT
export const ALOFT_M = 40 * FT

/** Settling speed by droplet class, m/s. */
export const SETTLE: Record<Job['droplet'], number> = { fine: 0.015, medium: 0.18, coarse: 0.75 }

export interface DriftEnv {
  loFt: number
  /** Wind vectors (east, north) in m/s at the two sensor heights. */
  uLo: [number, number]
  uHi: [number, number]
  loM: number
  hiM: number
  alpha: number
  ri: number
  /** Vertical and horizontal eddy diffusivity, m²/s. */
  kz: number
  kh: number
  /** Estimated top of the inversion layer, or null. */
  lidM: number | null
}

export function driftEnv(reading: Reading): DriftEnv {
  const e = explain(reading)
  const ustar = 0.1 * e.hi.windMph * MPH + 0.045
  const kn = 0.4 * ustar * 6
  const ri = Math.min(Math.max(e.ri, -3), 5)
  const kz = Math.max(ri > 0 ? kn / (1 + 5 * ri) ** 2 : kn * Math.sqrt(1 - 16 * ri), 0.005)
  const top = inversionTopFt(reading)
  return {
    loFt: e.lo.heightFt,
    uLo: [e.uLo[0] * MPH, e.uLo[1] * MPH], uHi: [e.uHi[0] * MPH, e.uHi[1] * MPH],
    loM: e.lo.heightFt * FT, hiM: e.hi.heightFt * FT, alpha: e.alpha, ri: e.ri,
    kz, kh: 1.5 * kz + 0.14, lidM: top === null ? null : top * FT,
  }
}

/** Wind (east, north) in m/s at a height: direction blends between the sensors, speed follows the fitted profile. */
export function windAtM(env: DriftEnv, zM: number): [number, number] {
  const z = Math.max(zM, 0.3)
  const f = Math.min(Math.max((z - env.loM) / (env.hiM - env.loM), 0), 1)
  const dx = env.uLo[0] * (1 - f) + env.uHi[0] * f
  const dy = env.uLo[1] * (1 - f) + env.uHi[1] * f
  const blend = Math.hypot(dx, dy)
  if (blend < 1e-6) return [0, 0]
  const speed = Math.hypot(env.uLo[0], env.uLo[1]) * Math.pow(z / env.loM, env.alpha)
  return [(dx / blend) * speed, (dy / blend) * speed]
}

export interface Droplet { x: number; y: number; z: number; vs: number; age: number; leftLow: boolean; hit: number }

export const gaussian = (rand: () => number) => () => {
  let u = 0
  while (!u) u = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** Advances one droplet. Returns false when it has landed or mixed out aloft. */
export function stepDroplet(p: Droplet, env: DriftEnv, dt: number, g: () => number, field: Pt[]): boolean {
  const w = windAtM(env, p.z)
  p.x += w[0] * dt + g() * Math.sqrt(2 * env.kh * dt)
  p.y += w[1] * dt + g() * Math.sqrt(2 * env.kz * dt + 2 * env.kh * dt) * 0.7
  p.z += -p.vs * dt + g() * Math.sqrt(2 * env.kz * dt)
  // A stable layer does not let droplets through its top: they stay in the layer.
  if (env.lidM !== null && p.z > env.lidM) p.z = env.lidM - (p.z - env.lidM) * 0.3
  p.age += dt
  if (p.z < LOW_M && !pointInPolygon(p.x, p.y, field)) p.leftLow = true
  return p.z > 0 && p.z < ALOFT_M * 2.5
}

export interface DriftResult {
  /** Percent of droplets that landed inside the block. */
  landedPct: number
  /** Percent that left the block below 15 ft, where people and crops are. */
  offLowPct: number
  /** Percent that mixed up and out above 40 ft. */
  aloftPct: number
  /** Droplets per 1,000 that passed within reach of each receptor, in the order given. */
  perThousand: number[]
}

export function batchDrift(reading: Reading, droplet: Job['droplet'], receptors: { x: number; y: number }[] = [], opts: { n?: number; steps?: number; field?: Pt[]; reachM?: number; seed?: number } = {}): DriftResult {
  const { n = 300, steps = 600, field = squareOutline(150), reachM = 20, seed = 1234 } = opts
  const env = driftEnv(reading)
  const rand = mulberry32(seed)
  const g = gaussian(rand)
  const dt = 2
  let landed = 0, offLow = 0, aloft = 0
  const hits = receptors.map(() => 0)
  for (let i = 0; i < n; i++) {
    const start = randomPointIn(field, rand)
    const p: Droplet = { x: start.x, y: start.y, z: 1 + rand() * (CANOPY_M - 1), vs: SETTLE[droplet], age: 0, leftLow: false, hit: -1 }
    const seen = new Set<number>()
    let alive = true
    for (let s = 0; s < steps && alive; s++) {
      alive = stepDroplet(p, env, dt, g, field)
      if (p.z < LOW_M * 1.4) receptors.forEach((r, j) => { if (!seen.has(j) && Math.hypot(p.x - r.x, p.y - r.y) <= reachM) { seen.add(j); hits[j]!++ } })
    }
    if (p.z >= ALOFT_M) aloft++
    else if (p.leftLow) offLow++
    else if (p.z <= 0) landed++
    else offLow += pointInPolygon(p.x, p.y, field) ? 0 : 1
  }
  const pct = (v: number) => Math.round((v / n) * 1000) / 10
  return { landedPct: pct(landed), offLowPct: pct(offLow), aloftPct: pct(aloft), perThousand: hits.map(h => Math.round((h / n) * 10000) / 10) }
}
