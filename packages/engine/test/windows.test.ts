import { describe, expect, it } from 'vitest'
import { BLOCKS, forecastReadings, rankWindows, scenarioById } from '../src'

describe('rankWindows', () => {
  const sc = scenarioById('dawn-inversion')
  const forecast = forecastReadings(BLOCKS[2]!, sc.anchors, sc.startMs + 30 * 60_000, 10)
  const ranked = rankWindows(forecast, 'fine', [{ x: 200, y: 0 }])
  it('only offers hours that are GO throughout', () => {
    expect(ranked.length).toBeGreaterThan(0)
    for (const w of ranked) {
      const inside = forecast.filter(f => f.timeMs >= w.startMs && f.timeMs < w.endMs)
      expect(inside.every(f => f.status === 'GO')).toBe(true)
      expect(w.endMs - w.startMs).toBe(3_600_000)
    }
  })
  it('orders them by modelled drift, lowest first', () => {
    const pcts = ranked.map(w => w.offLowPct)
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b))
  })
  it('offers nothing during the inversion', () => {
    expect(ranked.every(w => w.startMs >= sc.startMs + 240 * 60_000)).toBe(true)
  })
})
