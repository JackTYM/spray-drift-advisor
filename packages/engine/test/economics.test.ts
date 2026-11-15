import { describe, expect, it } from 'vitest'
import { QUALITY_MIX, WHAT_IF_PRESETS, evaluate, sprayEconomics, whatIfReading } from '../src'

const T = Date.parse('2026-11-17T12:00:00Z')
const reading = (id: string) => whatIfReading('block-3', WHAT_IF_PRESETS.find(p => p.id === id)!.w, T)

describe('spray economics', () => {
  it('uses volume shares that add up to one', () => {
    for (const mix of Object.values(QUALITY_MIX)) expect(mix.fine + mix.medium + mix.coarse).toBeCloseTo(1, 6)
  })
  it('loses more spray and money in an inversion than on a good morning', () => {
    const good = sprayEconomics(reading('ideal'), 'medium', 20, 40)
    const bad = sprayEconomics(reading('inversion'), 'medium', 20, 40)
    expect(good.costUsd).toBe(800)
    expect(bad.offLowPct).toBeGreaterThan(good.offLowPct)
    expect(bad.wastedUsd).toBeGreaterThan(good.wastedUsd)
    expect(bad.wastedUsd).toBe(Math.round((800 * bad.offTargetPct) / 100))
    expect(bad.landedPct + bad.offTargetPct).toBeGreaterThan(95)
  })
  it('loses less with a coarser spray', () => {
    expect(sprayEconomics(reading('inversion'), 'coarse', 20, 40).offTargetPct).toBeLessThan(sprayEconomics(reading('inversion'), 'fine', 20, 40).offTargetPct)
  })
  it('works out the extra product needed to make up the loss', () => {
    const e = sprayEconomics(reading('inversion'), 'fine', 20, 40)
    expect(e.extraPct).toBe(Math.round((e.offTargetPct / (100 - e.offTargetPct)) * 100))
  })
})

describe('what-if presets', () => {
  const status = (id: string, sites = [{ name: 'homes', type: 'homes', bearingDeg: 5, distanceM: 156 }]) =>
    evaluate({ history: [reading(id)], nowMs: T, sites }).status
  it('produce the status each one is meant to show', () => {
    expect(status('ideal', [])).toBe('GO')
    expect(status('inversion')).toBe('STOP')
    expect(status('dead-calm')).toBe('STOP')
    expect(status('gusty')).toBe('STOP')
    expect(status('toward-homes')).toBe('CAUTION')
    expect(status('shear')).toBe('STOP')
  })
})
