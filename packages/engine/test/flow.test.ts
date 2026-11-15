import { describe, expect, it } from 'vitest'
import {
  BLOCKS, alertsFor, applyAlert, applyHold, evaluate, interpolate, inversionLikely, nextSafeWindow, scenarioById, step, virtualTower,
  type AlertKind, type Hysteresis, type Reading, type SessionState, type Status,
} from '../src'

const MIN = 60_000

describe('a spray session through the session-night scenario', () => {
  it('starts GO, is stopped, gets a heads-up, then an all-clear', () => {
    const sc = scenarioById('session-night')
    const block = BLOCKS[0]
    const session: SessionState = {
      id: 's1', blockId: block.id, phase: 'spraying', interrupted: false, headsUpSent: false, startedMs: sc.startMs,
      job: { product: 'x', volatility: 'low', droplet: 'medium' },
    }
    const history: Reading[] = []
    let hyst: Hysteresis | null = null
    let prev: Status | null = null
    const statuses: Status[] = []
    const kinds: AlertKind[] = []

    for (let m = 0; m <= 960; m += 5) {
      const now = sc.startMs + m * MIN
      history.push(virtualTower(block, interpolate(sc.anchors, now), () => 0.5, false))
      if (history.length > 100) history.shift()
      const raw = evaluate({ history, nowMs: now, sites: block.sites, job: session.job, inversionLikely: inversionLikely(interpolate(sc.anchors, now + 60 * MIN)) })
      hyst = step(hyst, raw.status, now)
      const ev = applyHold(raw, hyst)
      const window = nextSafeWindow(block, sc.anchors, now, session.job)
      if (prev) for (const k of alertsFor(session, prev, ev.status, window?.startMs ?? null, now)) { applyAlert(session, k); kinds.push(k) }
      prev = ev.status
      statuses.push(ev.status)
    }

    expect(statuses[0]).toBe('GO')
    expect(statuses).toContain('STOP')
    expect(statuses[statuses.length - 1]).toBe('GO')
    expect(kinds).toEqual(['stop', 'heads-up', 'all-clear'])
  })
})
