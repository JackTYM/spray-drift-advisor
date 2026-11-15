import { describe, expect, it } from 'vitest'
import { evaluate, parseReading, richardson } from '../src/evaluate'
import type { EvalInput, Reading } from '../src/types'

const T0 = Date.parse('2026-11-17T05:00:00-07:00')
type L = [tempF: number, windMph: number, dirDeg: number]
const rd = (min: number, lo: L, hi: L): Reading => ({
  source: 'test', kind: 'measured', blockId: 'b', time: new Date(T0 + min * 60_000).toISOString(),
  levels: [
    { heightFt: 5, tempF: lo[0], windMph: lo[1], windDirDeg: lo[2] },
    { heightFt: 30, tempF: hi[0], windMph: hi[1], windDirDeg: hi[2] },
  ],
})
const run = (history: Reading[], extra: Partial<EvalInput> = {}) =>
  evaluate({ history, nowMs: Date.parse(history[history.length - 1].time), sites: [], ...extra })
const rules = (e: { triggers: { rule: string }[] }) => e.triggers.map(t => t.rule)

describe('evaluate', () => {
  it('is GO in mixed air with moderate wind', () => {
    const e = run([rd(0, [60, 5, 270], [59, 7, 270])])
    expect(e.status).toBe('GO')
    expect(e.triggers).toEqual([])
    expect(e.groundOnly.status).toBe('GO')
  })

  it('stops on an inversion that a ground reading cannot see', () => {
    const e = run([rd(0, [54, 3.5, 280], [61, 5, 265])])
    expect(e.status).toBe('STOP')
    expect(rules(e)).toContain('inversion')
    expect(e.deltaF).toBe(7)
    expect(e.ri).toBeGreaterThan(0.25)
    expect(e.groundOnly.status).toBe('GO')
  })

  it('cautions on wind below 3 mph', () => {
    const e = run([rd(0, [60, 2, 270], [59, 6, 270])])
    expect(e.status).toBe('CAUTION')
    expect(rules(e)).toEqual(['wind-low'])
  })

  it('stops on wind above 10 mph', () => {
    const e = run([rd(0, [60, 7, 270], [59, 11, 270])])
    expect(e.status).toBe('STOP')
    expect(rules(e)).toContain('wind-high')
  })

  it('lowers the wind limit to 8 mph for fine droplets', () => {
    const h = [rd(0, [60, 6, 270], [59, 9, 270])]
    expect(run(h).status).toBe('GO')
    expect(run(h, { job: { product: 'x', volatility: 'low', droplet: 'fine' } }).status).toBe('STOP')
  })

  it('lets label limits replace the defaults', () => {
    const job = { product: 'x', volatility: 'low' as const, droplet: 'medium' as const, labelMaxWindMph: 15 }
    expect(run([rd(0, [60, 8, 270], [59, 11, 270])], { job }).status).toBe('GO')
  })

  it('cautions on a 5 mph speed difference between heights', () => {
    const e = run([rd(0, [60, 3.5, 270], [59, 9, 270])])
    expect(e.status).toBe('CAUTION')
    expect(rules(e)).toEqual(['speed-shear'])
  })

  it('grades direction shear and ignores it in calm air', () => {
    expect(run([rd(0, [60, 4, 270], [59, 6, 330])]).status).toBe('CAUTION')
    expect(run([rd(0, [60, 4, 270], [59, 6, 90])]).status).toBe('STOP')
    expect(rules(run([rd(0, [60, 0.5, 90], [59, 6, 270])]))).not.toContain('direction-shear')
  })

  it('raises the result one level when wind blows toward a sensitive site', () => {
    const sites = [{ name: 'School', type: 'school', bearingDeg: 90, distanceM: 500 }]
    const e = run([rd(0, [60, 5, 270], [59, 7, 270])], { sites })
    expect(e.status).toBe('CAUTION')
    expect(rules(e)).toEqual(['sensitive-site'])
  })

  it('never reports GO on stale data', () => {
    const h = [rd(0, [60, 5, 270], [59, 7, 270])]
    const e = evaluate({ history: h, nowMs: T0 + 6 * 60_000, sites: [] })
    expect(e.status).toBe('CAUTION')
    expect(rules(e)).toEqual(['stale-data'])
  })

  it('cautions when an inversion is forming, and stops for a volatile product', () => {
    const h = [rd(0, [60, 5, 270], [59.2, 7, 270]), rd(15, [60, 5, 270], [59.6, 7, 270]), rd(20, [60, 5, 270], [59.7, 7, 270])]
    expect(rules(run(h))).toEqual(['inversion-forming'])
    expect(run(h).status).toBe('CAUTION')
    expect(run(h, { job: { product: 'x', volatility: 'high', droplet: 'medium' } }).status).toBe('STOP')
  })

  it('cautions when the forecast says an inversion is likely', () => {
    expect(rules(run([rd(0, [60, 5, 270], [58, 7, 270])], { inversionLikely: true }))).toEqual(['inversion-forming'])
  })

  it('uses the ground station for the ground-only verdict', () => {
    const ground = { station: 'az38', timeMs: T0, tempF: 60, windMph: 1, windDirDeg: 270 }
    const e = run([rd(0, [60, 5, 270], [59, 7, 270])], { ground })
    expect(e.status).toBe('GO')
    expect(e.groundOnly.status).toBe('CAUTION')
  })
})

describe('richardson', () => {
  const lv = (heightFt: number, tempF: number, windMph: number, windDirDeg = 270) => ({ heightFt, tempF, windMph, windDirDeg })
  it('is negative when air cools with height', () => {
    expect(richardson(lv(5, 60, 4), lv(30, 58, 6))).toBeLessThan(0)
  })
  it('is above 0.25 for a strong inversion in light wind', () => {
    expect(richardson(lv(5, 54, 3.5), lv(30, 61, 5))).toBeGreaterThan(0.25)
  })
  it('is below 0.25 when strong shear stirs the same inversion', () => {
    expect(richardson(lv(5, 54, 1, 90), lv(30, 61, 8, 270))).toBeLessThan(0.25)
  })
})

describe('parseReading', () => {
  const good = { source: 'logger-1', kind: 'measured', blockId: 'block-3', time: '2026-11-17T05:42:10-07:00',
    levels: [{ heightFt: 5, tempF: 54.1, windMph: 3.5, windDirDeg: 280 }, { heightFt: 30, tempF: 61, windMph: 5, windDirDeg: 265 }] }
  it('accepts a valid reading', () => {
    expect(parseReading(good)).toEqual({ ok: true, reading: good })
  })
  it('rejects fewer than two levels', () => {
    expect(parseReading({ ...good, levels: good.levels.slice(0, 1) })).toEqual({ ok: false, error: 'levels must contain at least two heights' })
  })
  it('rejects a bad time', () => {
    expect(parseReading({ ...good, time: 'yesterday' })).toEqual({ ok: false, error: 'time must be an ISO 8601 timestamp' })
  })
})
