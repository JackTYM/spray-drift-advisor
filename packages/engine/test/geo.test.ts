import { describe, expect, it } from 'vitest'
import { addressesFromPima, buildingsFromOverpass, compassOf, quadkey, downwindOf, isLowGround, offsetPoint, parseCdl, toAlbers } from '../src/geo'
import { distanceM } from '../src/adapters'

describe('geo', () => {
  it('projects to CONUS Albers', () => {
    const { x, y } = toAlbers(31.945, -110.975)
    expect(Math.abs(x - -1403426.5)).toBeLessThan(30)
    expect(Math.abs(y - 1096456.8)).toBeLessThan(30)
  })
  it('offsets a point by distance and bearing', () => {
    const p = offsetPoint(31.95, -110.96, 90, 400)
    expect(Math.round(distanceM(31.95, -110.96, p.lat, p.lon))).toBe(400)
    expect(p.lon).toBeGreaterThan(-110.96)
    expect(p.lat).toBeCloseTo(31.95, 3)
  })
  it('names compass directions', () => {
    expect([0, 44, 90, 200, 359].map(compassOf)).toEqual(['N', 'NE', 'E', 'S', 'N'])
  })
  it('reads a crop category from the CropScape response', () => {
    expect(parseCdl('<Result>{x: 1, y: 2, value: 204, category: "Pecans", color: "#00FF8C"}</Result>')).toBe('Pecans')
    expect(parseCdl('<error/>')).toBeNull()
  })
  it('converts address points with bearing and distance', () => {
    const json = { features: [
      { attributes: { STREET_NO: 16008, AD_STREET: 'CAMINO CASAL' }, geometry: { x: -110.96, y: 31.953 } },
      { attributes: {}, geometry: { x: -110.9, y: 31.95 } },
    ] }
    const a = addressesFromPima(json, 31.95, -110.96, 1000)
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ label: '16008 CAMINO CASAL', bearingDeg: 0 })
    expect(a[0]!.distanceM).toBeGreaterThan(320)
    expect(a[0]!.distanceM).toBeLessThan(345)
  })
  it('keeps only points inside the buffer on the downwind side', () => {
    const pts = [{ bearingDeg: 90, distanceM: 200 }, { bearingDeg: 270, distanceM: 200 }, { bearingDeg: 100, distanceM: 500 }, { bearingDeg: 130, distanceM: 250 }]
    // Wind from the west blows toward the east.
    expect(downwindOf(pts, 270, 300)).toEqual([{ bearingDeg: 90, distanceM: 200 }, { bearingDeg: 130, distanceM: 250 }])
  })
  it('reads building outlines with their bearing and distance', () => {
    const json = { elements: [
      { type: 'way', tags: { building: 'yes', name: 'Shop' }, geometry: [{ lat: 31.953, lon: -110.95 }, { lat: 31.953, lon: -110.9499 }, { lat: 31.9531, lon: -110.9499 }, { lat: 31.9531, lon: -110.95 }, { lat: 31.953, lon: -110.95 }] },
      { type: 'way', tags: { building: 'yes' }, geometry: [{ lat: 31.95, lon: -110.95 }] },
    ] }
    const b = buildingsFromOverpass(json, 31.953, -110.953)
    expect(b).toHaveLength(1)
    expect(b[0]!.name).toBe('Shop')
    expect(b[0]!.ring[0]).toEqual([-110.95, 31.953])
    expect(b[0]!.bearingDeg).toBeGreaterThan(85)
    expect(b[0]!.bearingDeg).toBeLessThan(95)
    expect(b[0]!.distanceM).toBeGreaterThan(250)
  })
  it('computes the tile key used by the building footprint files', () => {
    expect(quadkey(31.945, -110.956, 9)).toBe('023120010')
  })
  it('flags a block that sits below its surroundings', () => {
    expect(isLowGround(2690, [2700, 2698, 2702, 2696])).toBe(true)
    expect(isLowGround(2699, [2700, 2698, 2702, 2696])).toBe(false)
    expect(isLowGround(2690, [])).toBe(false)
  })
})
