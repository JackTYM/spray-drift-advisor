import { describe, expect, it } from 'vitest'
import { batchDrift, driftEnv, windAtM } from '../src/drift'
import type { Reading } from '../src/types'

const reading = (lo: [number, number, number], hi: [number, number, number]): Reading => ({
  source: 't', kind: 'measured', blockId: 'b', time: '2026-11-17T12:00:00Z',
  levels: [{ heightFt: 5, tempF: lo[0], windMph: lo[1], windDirDeg: lo[2] }, { heightFt: 30, tempF: hi[0], windMph: hi[1], windDirDeg: hi[2] }],
})
// Wind from the west in both cases, so drift goes east.
const inversion = reading([54, 3.5, 270], [61, 5, 270])
const mixed = reading([62, 5, 270], [61, 7, 270])

describe('drift model', () => {
  it('suppresses vertical mixing in an inversion', () => {
    expect(driftEnv(inversion).kz).toBeLessThan(driftEnv(mixed).kz / 5)
    expect(driftEnv(inversion).lidM).not.toBeNull()
    expect(driftEnv(mixed).lidM).toBeNull()
  })
  it('reproduces the sensor winds at the sensor heights', () => {
    const env = driftEnv(inversion)
    expect(Math.hypot(...windAtM(env, env.loM))).toBeCloseTo(3.5 * 0.44704, 2)
    expect(Math.hypot(...windAtM(env, env.hiM))).toBeCloseTo(5 * 0.44704, 1)
    expect(windAtM(env, 3)[0]).toBeGreaterThan(0)
  })
  it('keeps fine droplets low and moving off the block in an inversion', () => {
    const inv = batchDrift(inversion, 'fine')
    const mix = batchDrift(mixed, 'fine')
    expect(inv.offLowPct).toBeGreaterThan(mix.offLowPct)
    expect(inv.aloftPct).toBeLessThan(mix.aloftPct)
  })
  it('sends more droplets to a downwind receptor than an upwind one', () => {
    const r = batchDrift(inversion, 'fine', [{ x: 200, y: 0 }, { x: -200, y: 0 }])
    expect(r.perThousand[0]).toBeGreaterThan(r.perThousand[1]!)
    expect(r.perThousand[1]).toBe(0)
  })
  it('lands coarse droplets in the block', () => {
    expect(batchDrift(inversion, 'coarse').landedPct).toBeGreaterThan(batchDrift(inversion, 'fine').landedPct)
    expect(batchDrift(inversion, 'coarse').landedPct).toBeGreaterThan(70)
  })
  it('is repeatable for the same seed', () => {
    expect(batchDrift(inversion, 'fine')).toEqual(batchDrift(inversion, 'fine'))
  })
})
