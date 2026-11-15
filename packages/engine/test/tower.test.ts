import { describe, expect, it } from 'vitest'
import { BLOCKS, evaluate, groundFromAnchor, interpolate, nextSafeWindow, scenarioById, statusAt, virtualTower } from '../src'
import type { Reading } from '../src'

const MIN = 60_000
/** Runs a block through a scenario in 5-minute steps and returns the evaluation at `atMin`. */
function evalAt(scenarioId: string, blockId: string, atMin: number) {
  const sc = scenarioById(scenarioId)
  const block = BLOCKS.find(b => b.id === blockId)!
  const history: Reading[] = []
  for (let m = 0; m <= atMin; m += 5) history.push(virtualTower(block, interpolate(sc.anchors, sc.startMs + m * MIN), () => 0.5, false))
  const now = sc.startMs + atMin * MIN
  return evaluate({ history, nowMs: now, sites: block.sites, ground: groundFromAnchor(interpolate(sc.anchors, now), 'az38') })
}

describe('dawn-inversion scenario at 05:45', () => {
  it('stops Block 3 while the ground station says GO', () => {
    const e = evalAt('dawn-inversion', 'block-3', 45)
    expect(e.status).toBe('STOP')
    expect(e.triggers.map(t => t.rule)).toContain('inversion')
    expect(e.ri).toBeGreaterThan(0.25)
    expect(e.groundOnly.status).toBe('GO')
  })
  it('cautions Block 2 as its inversion forms', () => {
    const e = evalAt('dawn-inversion', 'block-2', 45)
    expect(e.status).toBe('CAUTION')
    expect(e.triggers.map(t => t.rule)).toEqual(['inversion-forming'])
  })
  it('leaves upslope Block 1 at GO', () => {
    expect(evalAt('dawn-inversion', 'block-1', 45).status).toBe('GO')
  })
})

describe('other scenarios', () => {
  it('stops for wind on the windy afternoon', () => {
    const e = evalAt('windy-afternoon', 'block-1', 30)
    expect(e.status).toBe('STOP')
    expect(e.triggers.map(t => t.rule)).toContain('wind-high')
  })
  it('is GO on the clean morning', () => {
    expect(evalAt('clean-morning', 'block-1', 30).status).toBe('GO')
  })
})

describe('forecast', () => {
  const sc = scenarioById('dawn-inversion')
  const block3 = BLOCKS[2]
  it('agrees with the live evaluation', () => {
    expect(statusAt(block3, sc.anchors, sc.startMs + 45 * MIN)).toBe('STOP')
  })
  it('finds the next safe window for Block 3 at 09:00', () => {
    const w = nextSafeWindow(block3, sc.anchors, sc.startMs + 30 * MIN)
    expect(w?.startMs).toBe(sc.startMs + 240 * MIN)
  })
})
