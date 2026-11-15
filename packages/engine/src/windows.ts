import { batchDrift } from './drift'
import type { Pt } from './field'
import type { Job, Reading, Status } from './types'

export interface RankedWindow {
  startMs: number
  endMs: number
  /** Average percent of fine droplets leaving the block low during the window. */
  offLowPct: number
  /** Highest count per 1,000 reaching any single receptor. */
  worstPerThousand: number
  worstReceptor: number | null
}

/**
 * Ranks one-hour blocks inside forecast GO periods by modelled off-target drift, lowest first.
 * A GO period can still differ a lot in how much spray leaves the block; this picks the best hour.
 */
export function rankWindows(forecast: { timeMs: number; status: Status; reading: Reading }[], droplet: Job['droplet'], receptors: Pt[] = [], field?: Pt[], slots = 2): RankedWindow[] {
  const drift = forecast.map(f => (f.status === 'GO' ? batchDrift(f.reading, droplet, receptors, { n: 160, steps: 400, field }) : null))
  const out: RankedWindow[] = []
  for (let i = 0; i + slots <= forecast.length; i++) {
    const part = drift.slice(i, i + slots)
    if (part.some(d => d === null)) continue
    const per = receptors.map((_, j) => Math.max(...part.map(d => d!.perThousand[j] ?? 0)))
    const worst = per.length ? Math.max(...per) : 0
    out.push({
      startMs: forecast[i]!.timeMs,
      endMs: forecast[i + slots - 1]!.timeMs + 1_800_000,
      offLowPct: Math.round((part.reduce((s, d) => s + d!.offLowPct, 0) / slots) * 10) / 10,
      worstPerThousand: worst,
      worstReceptor: worst > 0 ? per.indexOf(worst) : null,
    })
  }
  return out.sort((a, b) => a.offLowPct - b.offLowPct || a.worstPerThousand - b.worstPerThousand || a.startMs - b.startMs)
}
