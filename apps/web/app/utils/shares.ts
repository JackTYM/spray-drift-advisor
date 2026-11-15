import { normalCdf, type PlanHour } from '@drift/engine'

export interface Shares { go: number; caution: number; stop: number }

/**
 * For one hour, the share of outcomes that are sprayable, marginal or closed, given the measured error of the estimate.
 * Wind under the minimum is Caution by the rules; an inversion, wind over the limit or wind toward a site is Stop.
 */
export function hourShares(h: PlanHour): Shares {
  const m = h.margins
  const go = h.confidence
  const hardOk = normalCdf(m.inversion / m.sd) * normalCdf(m.windHigh / m.sw) * normalCdf(m.gust / (m.sw * 1.5)) * (m.other < 1 ? m.other : 1)
  const stop = Math.min(Math.max(1 - hardOk, 0), 1 - go)
  return { go, caution: Math.max(1 - go - stop, 0), stop }
}
