import { describe, expect, it } from 'vitest'
import { deltaTBand, deltaTC, explain, inversionTopFt, profileCurves, wetBulbC, windVector } from '../src/explain'
import type { Reading } from '../src/types'

const reading = (lo: [number, number, number], hi: [number, number, number]): Reading => ({
  source: 't', kind: 'measured', blockId: 'b', time: '2026-11-17T12:00:00Z',
  levels: [{ heightFt: 5, tempF: lo[0], windMph: lo[1], windDirDeg: lo[2] }, { heightFt: 30, tempF: hi[0], windMph: hi[1], windDirDeg: hi[2] }],
})

describe('explain', () => {
  it('matches a hand calculation for an inversion', () => {
    const e = explain(reading([49.1, 3.5, 290], [54.6, 5.5, 268]))
    expect(e.deltaF).toBe(5.5)
    expect(e.lapsePer100Ft).toBe(22)
    expect(e.dzM).toBe(7.6)
    expect(e.dThetaK).toBeCloseTo(3.13, 1)
    expect(e.ri).toBeGreaterThan(0.25)
    expect(e.turningDeg).toBe(22)
    expect(e.alpha).toBeCloseTo(0.25, 2)
  })
  it('points wind vectors where the air is going', () => {
    expect(windVector({ heightFt: 5, tempF: 50, windMph: 4, windDirDeg: 270 })).toEqual([4, 0])
    expect(windVector({ heightFt: 5, tempF: 50, windMph: 4, windDirDeg: 0 })[1]).toBe(-4)
  })
  it('fits curves through both sensors', () => {
    const c = profileCurves(reading([54, 3.5, 280], [61, 5, 265]))
    const at = (ft: number) => c.find(p => p.heightFt === ft)!
    expect(at(30).tempF).toBeCloseTo(61, 1)
    expect(at(30).windMph).toBeCloseTo(5, 1)
    expect(at(100).tempF).toBeLessThan(at(72).tempF)
  })
  it('estimates an inversion top only when inverted', () => {
    expect(inversionTopFt(reading([54, 3.5, 280], [61, 5, 265]))).toBe(72)
    expect(inversionTopFt(reading([60, 5, 270], [59, 7, 270]))).toBeNull()
  })
})

describe('Delta-T', () => {
  it('is near zero in saturated air and large in dry air', () => {
    expect(wetBulbC(20, 99)).toBeGreaterThan(19.5)
    expect(deltaTC(68, 95)).toBeLessThan(1)
    expect(deltaTC(95, 10)).toBeGreaterThan(12)
  })
  it('bands the result', () => {
    expect([1, 5, 11].map(deltaTBand)).toEqual(['humid', 'ideal', 'dry'])
  })
})
