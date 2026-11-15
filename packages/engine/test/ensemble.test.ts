import { describe, expect, it } from 'vitest'
import { breakTime, jobConfidence, jobWindows, type PlanHour } from '../src'

const T0 = Date.parse('2026-11-16T00:00:00-07:00')
const H = 3_600_000
const hour = (i: number, over: Partial<PlanHour['margins']> = {}, status: PlanHour['status'] = 'GO'): PlanHour => ({
  timeMs: T0 + i * H, status, confidence: 0.8, reasons: [], deltaF: 0, lowWindMph: 4, highWindMph: 6, gustMph: 8,
  reading: {} as PlanHour['reading'],
  margins: { windLow: 2, windHigh: 5, gust: 8, inversion: 2, sw: 1.5, sd: 1.5, other: 1, ...over },
})
const flat = (n: number, over: Partial<PlanHour['margins']> = {}) => Array.from({ length: n }, (_, i) => hour(i, over))

describe('jobConfidence', () => {
  it('is repeatable for the same seed', () => {
    const hs = flat(6)
    expect(jobConfidence(hs, T0, 180)).toBe(jobConfidence(hs, T0, 180))
    expect(jobConfidence(flat(6), T0, 180, { seed: 7 })).toBe(jobConfidence(flat(6), T0, 180, { seed: 7 }))
  })
  it('is no higher than any single hour it covers', () => {
    const hs = [hour(0), hour(1, { windHigh: 2 }), hour(2, { inversion: 1 }), hour(3)]
    const job = jobConfidence(hs, T0, 240)
    for (let i = 0; i < 4; i++) expect(job).toBeLessThanOrEqual(jobConfidence(hs, T0 + i * H, 60))
  })
  it('never rises with a longer job from the same start', () => {
    const hs = [hour(0), hour(1, { windHigh: 3 }), hour(2, { inversion: 1 }), hour(3, { other: 0.9 })]
    let prev = 1
    for (const m of [30, 60, 90, 120, 180, 240]) {
      const c = jobConfidence(hs, T0, m)
      expect(c).toBeLessThanOrEqual(prev)
      prev = c
    }
  })
  it('beats the product of single-hour values because errors are correlated', () => {
    const hs = flat(2, { windHigh: 1.5, windLow: 1.5 })
    const one = jobConfidence(hs, T0, 60, { n: 2000 }), two = jobConfidence(hs, T0 + H, 60, { n: 2000 })
    expect(one).toBeGreaterThan(0.2)
    expect(one).toBeLessThan(0.95)
    expect(jobConfidence(hs, T0, 120, { n: 2000 })).toBeGreaterThan(Math.round(one * two * 100) / 100)
  })
  it('is 0 outside the plan', () => {
    const hs = flat(2)
    expect(jobConfidence(hs, T0 - H, 60)).toBe(0)
    expect(jobConfidence(hs, T0 + H, 90)).toBe(0)
  })
})

describe('jobWindows', () => {
  it('returns windows at least as long as the job', () => {
    const hs = [...flat(4), hour(4, {}, 'STOP'), ...flat(3).map((h, i) => hour(5 + i))]
    const ws = jobWindows(hs, 45)
    expect(ws.length).toBeGreaterThan(0)
    for (const w of ws) {
      expect(w.endMs - w.startMs).toBeGreaterThanOrEqual(45 * 60_000)
      expect(w.bestConfidence).toBeGreaterThanOrEqual(w.confidence - 1)
      expect(w.latestStartMs + 45 * 60_000).toBe(w.endMs)
    }
    expect(ws[0]!.startMs).toBeLessThan(ws[ws.length - 1]!.startMs)
  })
  it('returns none when no stretch fits', () => {
    const hs = [hour(0), hour(1, {}, 'STOP'), hour(2), hour(3, {}, 'STOP')]
    expect(jobWindows(hs, 90)).toEqual([])
  })
})

describe('breakTime', () => {
  it('is null with no inversion', () => {
    expect(breakTime(flat(6))).toBeNull()
  })
  it('gives ordered percentiles when an inversion clears', () => {
    const hs = [hour(0, { inversion: -1 }), hour(1, { inversion: -0.5 }), hour(2, { inversion: 0.5 }), hour(3, { inversion: 2 }), hour(4, { inversion: 3 }), hour(5, { inversion: 3 })]
    const b = breakTime(hs)
    expect(b).not.toBeNull()
    expect(b!.p10Ms).toBeLessThanOrEqual(b!.p50Ms)
    expect(b!.p50Ms).toBeLessThanOrEqual(b!.p90Ms)
  })
})
