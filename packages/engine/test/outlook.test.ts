import { describe, expect, it } from 'vitest'
import { leaveOneOut, outlook, representativeness, residuals, tripCost, vaporNote, type PlanHour, type StationObs } from '../src'

const T0 = Date.parse('2026-11-16T12:00:00-07:00')
const H = 3_600_000
const hour = (i: number, over: Partial<PlanHour> & { windLow?: number; inversion?: number } = {}): PlanHour => ({
  timeMs: T0 + i * H, status: 'GO', confidence: 0.9, reasons: [], deltaF: -1, lowWindMph: 5, highWindMph: 8, gustMph: 10,
  reading: { source: 't', kind: 'modelled', blockId: 'f', time: '', levels: [
    { heightFt: 5, tempF: 60, windMph: 4, windDirDeg: 200 }, { heightFt: 30, tempF: 59, windMph: 7, windDirDeg: 250 },
  ] },
  margins: { windLow: over.windLow ?? 4, windHigh: 8, gust: 10, inversion: over.inversion ?? 5, sw: 1, sd: 1, other: 1 },
  ...over,
})
const win = (startH: number, endH: number) => ({ startMs: T0 + startH * H, endMs: T0 + endH * H, latestStartMs: T0 + (endH - 1) * H, confidence: 0.8 })

describe('outlook', () => {
  const hours = Array.from({ length: 12 }, (_, i) => hour(i))
  it('decides go, wait or no-window', () => {
    expect(outlook(hours, win(0, 6), 60, T0).decision).toBe('go')
    expect(outlook(hours, win(3, 6), 60, T0).decision).toBe('wait')
    expect(outlook(hours, null, 60, T0).decision).toBe('no-window')
  })
  it('sees a rising and a falling series', () => {
    const up = [0.3, 0.5, 0.7, 0.9].map((c, i) => hour(i, { confidence: c, windLow: -1 + i * 2 }))
    const down = [0.9, 0.7, 0.5, 0.3].map((c, i) => hour(i, { confidence: c, windLow: 5 - i * 2 }))
    expect(outlook(up, null, 60, T0).trend).toBe('improving')
    expect(outlook(up, null, 60, T0).trendText).toContain('picking up')
    expect(outlook(down, null, 60, T0).trend).toBe('worsening')
    expect(outlook(down, null, 60, T0).trendText).toContain('dying down')
    expect(outlook(hours, null, 60, T0).trend).toBe('steady')
  })
  it('says to check an hour before the window opens', () => {
    const o = outlook(hours, win(4, 8), 60, T0)
    expect(o.checkAgainMs).toBe(T0 + 3 * H)
    expect(outlook(hours, null, 60, T0).checkAgainMs).toBe(T0 + 3 * H)
  })
  it('picks the hour nearest six hours ahead', () => {
    const o = outlook(hours, null, 60, T0)
    expect(o.sixHour!.timeMs).toBe(T0 + 6 * H)
    expect(outlook([hour(0)], null, 60, T0).sixHour).toBeNull()
  })
  it('names the weakest hour inside the job', () => {
    const hs = hours.map((h, i) => (i === 2 ? hour(2, { windLow: 0.3 }) : h))
    expect(outlook(hs, win(0, 6), 180, T0).duringJob).toContain('wind dropping below 5 mph')
    expect(outlook(hs, null, 180, T0).duringJob).toBe('No job fits, so nothing to check.')
  })
  it('compares wind at two heights', () => {
    expect(outlook(hours, null, 60, T0).windAtHeight).toContain('turns')
  })
})

describe('vapor note, trip cost, and station wording', () => {
  it('only speaks up when warm-over-cool air is coming', () => {
    expect(vaporNote(Array.from({ length: 6 }, (_, i) => hour(i)), T0)).toBeNull()
    const note = vaporNote([hour(1), hour(2, { inversion: -1 })], T0)
    expect(note).toContain('warm-over-cool air')
    expect(note).toContain('low-volatility')
  })
  it('prices the trip', () => {
    expect(tripCost(0.8, 500)).toBe(100)
  })
  it('describes how well a station stands in', () => {
    const s = { id: 'a', name: 'Sahuarita', network: 'AZMet', lat: 0, lon: 0, distanceKm: 1.8, dElevM: -6, weight: 0.95, dTempF: 0, dWindMph: 0 }
    expect(representativeness(s)).toBe('Sahuarita stands in for this field well: 1.8 km away, 20 ft lower, 95% of the correction.')
    expect(representativeness({ ...s, weight: 0.2 })).toContain('partly')
    expect(representativeness({ ...s, weight: 0.05 })).toContain('barely')
  })
})

describe('single nearest station baseline', () => {
  const st = (id: string, lon: number, tempF: number, windMph: number): StationObs => ({ id, name: id, network: 'AZMet', lat: 32, lon, elevM: 800, timeMs: T0, tempF, windMph, windDirDeg: 270 })
  it('equals the known error for two stations', () => {
    const m = { tempF: 50, windMph: 5, windDirDeg: 270 }
    const skill = leaveOneOut(residuals([st('a', -111, 50, 4), st('b', -110.9, 46, 7)], [m, m]))
    expect(skill.nearestTempF).toBe(4)
    expect(skill.nearestWindMph).toBe(3)
    expect(leaveOneOut(residuals([st('a', -111, 50, 4)], [m])).nearestTempF).toBe(0)
  })
})
