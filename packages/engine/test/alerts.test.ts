import { describe, expect, it } from 'vitest'
import { alertsFor, applyAlert, postWatchMs, type SessionState } from '../src/alerts'

const MIN = 60_000
const session = (over: Partial<SessionState> = {}): SessionState => ({
  id: 's1', blockId: 'block-1', phase: 'spraying', interrupted: false, headsUpSent: false, startedMs: 0,
  job: { product: 'x', volatility: 'low', droplet: 'medium' }, ...over,
})

describe('alertsFor', () => {
  it('sends stop once when a spraying session enters STOP', () => {
    expect(alertsFor(session(), 'CAUTION', 'STOP', null, 0)).toEqual(['stop'])
    expect(alertsFor(session(), 'STOP', 'STOP', null, 0)).toEqual([])
  })
  it('sends stop during the post-spray watch', () => {
    expect(alertsFor(session({ phase: 'post-watch' }), 'GO', 'STOP', null, 0)).toEqual(['stop'])
  })
  it('sends all-clear when an interrupted session returns to GO', () => {
    expect(alertsFor(session({ interrupted: true }), 'STOP', 'GO', null, 0)).toEqual(['all-clear'])
  })
  it('sends all-clear to a waiting session', () => {
    expect(alertsFor(session({ phase: 'waiting' }), 'CAUTION', 'GO', null, 0)).toEqual(['all-clear'])
  })
  it('sends heads-up once when a window opens within 30 minutes', () => {
    const s = session({ phase: 'waiting' })
    expect(alertsFor(s, 'STOP', 'STOP', 45 * MIN, 0)).toEqual([])
    expect(alertsFor(s, 'STOP', 'STOP', 25 * MIN, 0)).toEqual(['heads-up'])
    applyAlert(s, 'heads-up')
    expect(alertsFor(s, 'STOP', 'STOP', 20 * MIN, 0)).toEqual([])
  })
  it('sends nothing to a closed session', () => {
    expect(alertsFor(session({ phase: 'closed' }), 'GO', 'STOP', null, 0)).toEqual([])
  })
})

describe('postWatchMs', () => {
  it('is 4 hours for a volatile product and 30 minutes otherwise', () => {
    expect(postWatchMs({ product: 'x', volatility: 'high', droplet: 'medium' })).toBe(4 * 60 * MIN)
    expect(postWatchMs({ product: 'x', volatility: 'low', droplet: 'medium' })).toBe(30 * MIN)
  })
})
