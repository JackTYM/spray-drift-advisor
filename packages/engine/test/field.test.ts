import { describe, expect, it } from 'vitest'
import { BLOCKS, areaAcres, bounds, localOutline, mulberry32, pointInPolygon, randomPointIn, rowSpans, squareOutline, toLngLat, toLocal } from '../src'

describe('field geometry', () => {
  const sq = squareOutline(100)
  it('tests points against a field outline', () => {
    expect(pointInPolygon(0, 0, sq)).toBe(true)
    expect(pointInPolygon(120, 0, sq)).toBe(false)
  })
  it('clips east-west rows to the outline', () => {
    const rows = rowSpans(sq, 10, 0)
    expect(rows).toHaveLength(20)
    expect(rows.every(r => r.x0 === -100 && r.x1 === 100)).toBe(true)
    // An L-shaped field gets shorter rows where the corner is cut out.
    const l = [{ x: 0, y: 100 }, { x: 60, y: 100 }, { x: 60, y: 60 }, { x: 100, y: 60 }, { x: 100, y: 0 }, { x: 0, y: 0 }]
    const spans = rowSpans(l, 20, 0)
    expect(spans.find(r => r.y === 90)!.x1).toBe(60)
    expect(spans.find(r => r.y === 30)!.x1).toBe(100)
  })
  it('measures a field in acres', () => {
    expect(areaAcres(squareOutline(100))).toBe(9.9)
  })
  it('picks random points inside the field', () => {
    const rand = mulberry32(3)
    for (let i = 0; i < 50; i++) { const p = randomPointIn(sq, rand); expect(pointInPolygon(p.x, p.y, sq)).toBe(true) }
  })
  it('round-trips between local metres and coordinates', () => {
    const p = toLocal(31.95, -110.95, 31.951, -110.949)
    const [lon, lat] = toLngLat(31.95, -110.95, p.x, p.y)
    expect(lat).toBeCloseTo(31.951, 6)
    expect(lon).toBeCloseTo(-110.949, 6)
  })
  it('gives every block a real field of plausible size around its centre', () => {
    for (const b of BLOCKS) {
      const o = localOutline(b)
      const bb = bounds(o)
      expect(pointInPolygon(0, 0, o)).toBe(true)
      expect(bb.maxX - bb.minX).toBeGreaterThan(150)
      expect(bb.maxX - bb.minX).toBeLessThan(450)
      expect(bb.maxY - bb.minY).toBeGreaterThan(300)
      expect(bb.maxY - bb.minY).toBeLessThan(650)
    }
  })
})
