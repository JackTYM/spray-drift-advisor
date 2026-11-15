import { DEFAULTS } from './evaluate'
import type { Anchor } from './tower'
import type { GroundObs } from './types'

export interface BacktestResult {
  hoursCompared: number
  inversionHours: number
  /** Ground wind within limits while the profile showed an inversion. */
  missedHours: number
  nightsCompared: number
  /** Local dates (the evening the night began) with at least one missed hour. */
  missedNights: string[]
}

const HOUR = 3_600_000
/** A night is labelled by the local date 12 hours before each hour, in UTC-7. */
const nightOf = (ms: number): string => new Date(ms - 12 * HOUR - 7 * HOUR).toISOString().slice(0, 10)

export function backtest(ground: GroundObs[], anchors: Anchor[]): BacktestResult {
  const byHour = new Map(anchors.map(a => [Math.round(a.timeMs / HOUR), a]))
  const nights = new Set<string>()
  const missed = new Set<string>()
  let hoursCompared = 0
  let inversionHours = 0
  let missedHours = 0
  for (const g of ground) {
    const a = byHour.get(Math.round(g.timeMs / HOUR))
    if (!a) continue
    hoursCompared++
    nights.add(nightOf(g.timeMs))
    if (a.temp80mF <= a.temp2mF) continue
    inversionHours++
    if (g.windMph >= DEFAULTS.minWindMph && g.windMph <= DEFAULTS.maxWindMph) {
      missedHours++
      missed.add(nightOf(g.timeMs))
    }
  }
  return { hoursCompared, inversionHours, missedHours, nightsCompared: nights.size, missedNights: [...missed].sort() }
}
