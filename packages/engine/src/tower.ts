import type { GroundObs, Reading, ReadingKind, SensitiveSite } from './types'

/** One point of the regional profile: real from Open-Meteo, or scripted. */
export interface Anchor {
  timeMs: number
  temp2mF: number
  temp80mF: number
  wind10Mph: number
  wind80Mph: number
  dir10Deg: number
  dir80Deg: number
  cloudPct: number
  isDay: boolean
}

export interface BlockModel {
  id: string
  name: string
  crop: string
  note: string
  lat: number
  lon: number
  /** Regional 2 m to 80 m difference (°F) this block needs before it inverts. Low ground: 0. */
  offsetF: number
  /** Strength of the block's inversion relative to the regional signal. */
  factor: number
  /** How far the low-level wind turns in fully stable air (drainage flow). */
  turnDeg: number
  sites: SensitiveSite[]
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)

export function interpolate(anchors: Anchor[], tMs: number): Anchor {
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  if (tMs <= first.timeMs) return { ...first, timeMs: tMs }
  if (tMs >= last.timeMs) return { ...last, timeMs: tMs }
  const i = anchors.findIndex(a => a.timeMs > tMs)
  const a = anchors[i - 1]
  const b = anchors[i]
  const f = (tMs - a.timeMs) / (b.timeMs - a.timeMs)
  const lerp = (x: number, y: number) => x + (y - x) * f
  const lerpDir = (x: number, y: number) => (x + (((y - x + 540) % 360) - 180) * f + 360) % 360
  return {
    timeMs: tMs,
    temp2mF: lerp(a.temp2mF, b.temp2mF),
    temp80mF: lerp(a.temp80mF, b.temp80mF),
    wind10Mph: lerp(a.wind10Mph, b.wind10Mph),
    wind80Mph: lerp(a.wind80Mph, b.wind80Mph),
    dir10Deg: lerpDir(a.dir10Deg, b.dir10Deg),
    dir80Deg: lerpDir(a.dir80Deg, b.dir80Deg),
    cloudPct: lerp(a.cloudPct, b.cloudPct),
    isDay: a.isDay,
  }
}

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Baseline virtual tower: scales the regional 2 m to 80 m profile down to 5 ft and 30 ft.
 * - Temperature: an inversion is concentrated near the ground, so a positive regional
 *   difference maps to a strong 5-30 ft difference; a lapse maps to a small negative one.
 * - Wind: power-law profile whose exponent grows as the air gets more stable.
 * - Direction: the low-level wind turns toward the drainage direction in stable air.
 */
export function virtualTower(block: BlockModel, a: Anchor, rand: () => number, noise = true, kind: ReadingKind = 'modelled', source = 'virtual-tower'): Reading {
  const n = (amp: number) => (noise ? (rand() - 0.5) * 2 * amp : 0)
  const g = a.temp80mF - a.temp2mF - block.offsetF
  const stab = clamp(g / 8, 0, 1)
  const delta = g > 0 ? 0.9 * g * block.factor : Math.max(0.7 * g, -1)
  const lowTemp = a.temp2mF + n(0.04)
  const lowWind = Math.max(a.wind10Mph * Math.pow(0.15, 0.2 + 0.2 * stab) + n(0.2), 0)
  return {
    source,
    kind,
    blockId: block.id,
    time: new Date(a.timeMs).toISOString(),
    levels: [
      { heightFt: 5, tempF: r2(lowTemp), windMph: r1(lowWind), windDirDeg: Math.round((a.dir10Deg + stab * block.turnDeg + n(4) + 360) % 360) },
      { heightFt: 30, tempF: r2(lowTemp + delta + n(0.04)), windMph: r1(Math.max(a.wind10Mph + n(0.2), 0)), windDirDeg: Math.round((a.dir10Deg + n(4) + 360) % 360) },
    ],
  }
}

/** Ground station stand-in for scripted scenarios: an exposed station outside the canopy. */
export const groundFromAnchor = (a: Anchor, station: string): GroundObs => ({
  station, timeMs: a.timeMs, tempF: r1(a.temp2mF), windMph: r1(a.wind10Mph * 0.75), windDirDeg: Math.round(a.dir10Deg),
  // Scripted humidity: damp at night, dry by day.
  rhPct: a.isDay ? 35 : 82,
})
