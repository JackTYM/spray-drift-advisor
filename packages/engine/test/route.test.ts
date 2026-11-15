import { describe, expect, it } from 'vitest'
import { planRoute, type RouteField } from '../src/route'

const MIN = 60_000
const now = Date.UTC(2026, 5, 1, 2, 0)
const win = (startMin: number, latestMin: number, endMin: number) => ({ startMs: now + startMin * MIN, latestStartMs: now + latestMin * MIN, endMs: now + endMin * MIN, confidence: 0.8 })
const field = (id: string, lon: number, jobMinutes: number, windows: RouteField['windows']): RouteField => ({ id, name: id, lat: 33, lon, jobMinutes, windows })

describe('planRoute', () => {
  const fields = [
    field('a', -112.0, 60, [win(0, 600, 900)]),
    field('b', -112.1, 45, [win(30, 120, 300)]),
    field('c', -112.2, 30, [win(0, 40, 200), win(300, 400, 500)]),
  ]

  it('never starts outside a window, and finish minus start is the job', () => {
    const plan = planRoute(fields, { nowMs: now })
    for (const s of plan.stops) {
      const f = fields.find((x) => x.id === s.id)!
      expect(f.windows.some((w) => s.startMs >= w.startMs && s.startMs <= w.latestStartMs)).toBe(true)
      expect(s.finishMs - s.startMs).toBe(f.jobMinutes * MIN)
    }
  })

  it('visits the field whose only window closes soon first', () => {
    const plan = planRoute([field('late', -112.0, 30, [win(0, 600, 900)]), field('soon', -112.05, 30, [win(0, 20, 100)])], { nowMs: now })
    expect(plan.stops[0].id).toBe('soon')
    expect(plan.done).toBe(2)
  })

  it('defers a field with no windows', () => {
    const plan = planRoute([...fields, field('none', -112.3, 30, [])], { nowMs: now })
    expect(plan.deferred).toEqual([{ id: 'none', name: 'none', reason: 'No window in the next 48 hours' }])
  })

  it('defers a field whose window closes before the crew can get there', () => {
    const plan = planRoute([field('x', -112, 120, [win(0, 600, 900)]), field('y', -112.1, 30, [win(0, 30, 100)])], { nowMs: now, from: { lat: 33, lon: -111 } })
    expect(plan.deferred.every((d) => d.reason === 'Its window closes before the crew is free to get there')).toBe(true)
  })

  it('does at least as many jobs as list order', () => {
    const plan = planRoute(fields, { nowMs: now })
    expect(plan.done).toBeGreaterThanOrEqual(plan.listOrder.done)
  })

  it('matches distance for a known pair', () => {
    // 0.1 degrees of longitude at 33 N is about 9.3 km; x1.3 at 35 mph
    const plan = planRoute([field('p', -112, 10, [win(0, 600, 900)]), field('q', -112.1, 10, [win(0, 600, 900)])], { nowMs: now })
    const km = 0.1 * 111.195 * Math.cos((33 * Math.PI) / 180)
    const expected = ((km / 1.609344) * 1.3 / 35) * 60
    expect(plan.stops[0].travelMinutes).toBe(0)
    expect(plan.stops[1].travelMinutes).toBeCloseTo(expected, 0)
  })

  it('cost rises with distance', () => {
    const at = (lon: number) => planRoute([field('p', -112, 10, [win(0, 600, 900)]), field('q', lon, 10, [win(0, 600, 900)])], { nowMs: now })
    const near = at(-112.05)
    const far = at(-112.3)
    expect(far.driveMiles).toBeGreaterThan(near.driveMiles)
    expect(far.costUsd).toBeGreaterThan(near.costUsd)
  })

  it('a lower-confidence window costs more than a higher one', () => {
    const conf = (c: number) => planRoute([field('p', -112, 10, [{ ...win(0, 600, 900), confidence: c }])], { nowMs: now })
    expect(conf(0.4).costUsd).toBeGreaterThan(conf(0.9).costUsd)
  })

  it('the chosen order costs no more than list order when both do the same number of jobs', () => {
    const list = [
      field('far', -112.4, 20, [win(0, 900, 1200)]),
      field('near', -112.0, 20, [win(0, 900, 1200)]),
      field('mid', -112.2, 20, [win(0, 900, 1200)]),
    ]
    const plan = planRoute(list, { nowMs: now })
    expect(plan.listOrder.done).toBe(plan.done)
    expect(plan.costUsd).toBeLessThanOrEqual(plan.listOrder.costUsd)
  })

  it('uses the given costs', () => {
    const f = [field('p', -112, 10, [win(0, 600, 900)]), field('q', -112.2, 10, [win(0, 600, 900)])]
    const a = planRoute(f, { nowMs: now, costs: { crewPerHourUsd: 100, fuelPerMileUsd: 0, wastedTripUsd: 0 } })
    expect(a.costUsd).toBe(Math.round((a.driveMinutes / 60) * 100))
  })

  it('handles more than seven fields', () => {
    const many = Array.from({ length: 9 }, (_, i) => field(`f${i}`, -112 - i * 0.02, 20, [win(0, 900, 1200)]))
    expect(planRoute(many, { nowMs: now }).done).toBe(9)
  })
})
