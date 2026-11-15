import { evaluate } from './evaluate'
import { interpolate, virtualTower, type Anchor, type BlockModel } from './tower'
import type { Job, Reading, SafeWindow, SensitiveSite, Status } from './types'

const HOUR = 3_600_000
const HALF = 1_800_000

/** Forecast-based early warning: a clear, calm night. */
export const inversionLikely = (a: Anchor): boolean => !a.isDay && a.cloudPct < 30 && a.wind10Mph < 5

/** What the engine would say for this block at a future time, using the same model and rules. */
export function statusAt(block: BlockModel, anchors: Anchor[], tMs: number, job?: Job, sites: SensitiveSite[] = block.sites): Status {
  const reading = virtualTower(block, interpolate(anchors, tMs), () => 0.5, false)
  return evaluate({ history: [reading], nowMs: tMs, job, sites, inversionLikely: inversionLikely(interpolate(anchors, tMs + HOUR)) }).status
}

/** Forecast in half-hour steps with the modelled tower reading for each step. */
export function forecastReadings(block: BlockModel, anchors: Anchor[], nowMs: number, hours = 24, job?: Job, sites: SensitiveSite[] = block.sites): { timeMs: number; status: Status; reading: Reading }[] {
  const start = Math.ceil(nowMs / HALF) * HALF
  const out: { timeMs: number; status: Status; reading: Reading }[] = []
  for (let t = start; t < start + hours * HOUR; t += HALF) {
    const reading = virtualTower(block, interpolate(anchors, t), () => 0.5, false)
    const status = evaluate({ history: [reading], nowMs: t, job, sites, inversionLikely: inversionLikely(interpolate(anchors, t + HOUR)) }).status
    out.push({ timeMs: t, status, reading })
  }
  return out
}

export function forecastStrip(block: BlockModel, anchors: Anchor[], nowMs: number, hours = 24, job?: Job, sites?: SensitiveSite[]): { timeMs: number; status: Status }[] {
  const start = Math.ceil(nowMs / HALF) * HALF
  const out: { timeMs: number; status: Status }[] = []
  for (let t = start; t < start + hours * HOUR; t += HALF) out.push({ timeMs: t, status: statusAt(block, anchors, t, job, sites) })
  return out
}

export function nextSafeWindow(block: BlockModel, anchors: Anchor[], nowMs: number, job?: Job, sites?: SensitiveSite[]): SafeWindow | null {
  const strip = forecastStrip(block, anchors, nowMs, 36, job, sites)
  const i = strip.findIndex(s => s.status === 'GO')
  if (i < 0) return null
  let j = i
  while (j + 1 < strip.length && strip[j + 1].status === 'GO') j++
  return { startMs: strip[i].timeMs, endMs: strip[j].timeMs + HALF }
}
