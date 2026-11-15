import { describe, expect, it } from 'vitest'
import { applyHold, step } from '../src/hysteresis'
import type { Evaluation } from '../src/types'

const MIN = 60_000
describe('step', () => {
  it('adopts the first status as is', () => {
    expect(step(null, 'CAUTION', 0).status).toBe('CAUTION')
  })
  it('worsens immediately', () => {
    expect(step(step(null, 'GO', 0), 'STOP', MIN).status).toBe('STOP')
  })
  it('holds a better status for 10 minutes', () => {
    let h = step(null, 'STOP', 0)
    h = step(h, 'GO', 1 * MIN)
    expect(h.status).toBe('STOP')
    h = step(h, 'GO', 10 * MIN)
    expect(h.status).toBe('STOP')
    h = step(h, 'GO', 11 * MIN)
    expect(h.status).toBe('GO')
  })
  it('restarts the wait when conditions go bad again', () => {
    let h = step(null, 'STOP', 0)
    h = step(h, 'GO', 1 * MIN)
    h = step(h, 'STOP', 5 * MIN)
    h = step(h, 'GO', 6 * MIN)
    h = step(h, 'GO', 12 * MIN)
    expect(h.status).toBe('STOP')
    expect(step(h, 'GO', 16 * MIN).status).toBe('GO')
  })
  it('clears only to the worst status seen while waiting', () => {
    let h = step(null, 'STOP', 0)
    h = step(h, 'CAUTION', 1 * MIN)
    h = step(h, 'GO', 6 * MIN)
    expect(step(h, 'GO', 11 * MIN).status).toBe('CAUTION')
  })
})

describe('applyHold', () => {
  const raw: Evaluation = { status: 'GO', triggers: [], groundOnly: { status: 'GO', triggers: [] }, deltaF: -1, ri: -0.2 }
  it('adds a holding trigger when the held status differs', () => {
    const e = applyHold(raw, { status: 'STOP', betterSinceMs: 0, pending: 'GO' })
    expect(e.status).toBe('STOP')
    expect(e.triggers.map(t => t.rule)).toEqual(['holding'])
  })
  it('returns the raw evaluation when nothing is held', () => {
    expect(applyHold(raw, { status: 'GO', betterSinceMs: null, pending: null })).toBe(raw)
  })
})
