import { describe, expect, it } from 'vitest'
import { anchorsFromOpenMeteo, groundFromAzmet, readingsFromCsv, sitesFromOverpass, summarize } from '../src/adapters'
import { backtest } from '../src/backtest'

describe('anchorsFromOpenMeteo', () => {
  it('converts hourly arrays', () => {
    const json = { hourly: {
      time: [1794722400, 1794726000], temperature_2m: [56.5, 56.2], temperature_80m: [59.2, 58.9],
      wind_speed_10m: [2.3, 0.7], wind_speed_80m: [1.4, 0.9], wind_direction_10m: [201, 172], wind_direction_80m: [153, 68],
      cloud_cover: [50, 3], is_day: [0, 1],
    } }
    const a = anchorsFromOpenMeteo(json)
    expect(a).toHaveLength(2)
    expect(a[0]).toEqual({ timeMs: 1794722400000, temp2mF: 56.5, temp80mF: 59.2, wind10Mph: 2.3, wind80Mph: 1.4, dir10Deg: 201, dir80Deg: 153, cloudPct: 50, isDay: false })
    expect(a[1].isDay).toBe(true)
  })
  it('skips hours with missing values', () => {
    const json = { hourly: { time: [1], temperature_2m: [null], temperature_80m: [1], wind_speed_10m: [1], wind_speed_80m: [1], wind_direction_10m: [1], wind_direction_80m: [1], cloud_cover: [1], is_day: [1] } }
    expect(anchorsFromOpenMeteo(json)).toEqual([])
  })
})

describe('groundFromAzmet', () => {
  it('converts a 15-minute row from metric', () => {
    const row = { datetime: '2026-11-15 11:34:04', temp_airC: '20.0', wind_spd_mps: '0.5', wind_vector_dir: '164' }
    expect(groundFromAzmet(row, 'az38')).toEqual({ station: 'az38', timeMs: Date.parse('2026-11-15T11:34:04-07:00'), tempF: 68, windMph: 1.1, windDirDeg: 164 })
  })
  it('converts an hourly row that already has imperial fields', () => {
    const row = { date_datetime: '2025-01-10 01:00:00', temp_airF: '38.3', temp_airC: '3.5', wind_spd_mph: '1.8', wind_spd_mps: '0.8', wind_vector_dir: '57' }
    expect(groundFromAzmet(row, 'az38')).toEqual({ station: 'az38', timeMs: Date.parse('2025-01-10T01:00:00-07:00'), tempF: 38.3, windMph: 1.8, windDirDeg: 57 })
  })
  it('returns null for a row with missing-value sentinels', () => {
    expect(groundFromAzmet({ datetime: '2026-11-15 11:34:04', temp_airC: '-9999.0', wind_spd_mps: '0.5', wind_vector_dir: '164' }, 'az38')).toBeNull()
  })
})

describe('sitesFromOverpass', () => {
  it('computes bearing and distance and drops far sites', () => {
    const json = { elements: [
      { type: 'node', lat: 31.954, lon: -110.975, tags: { amenity: 'school', name: 'North School' } },
      { type: 'way', center: { lat: 31.945, lon: -110.965 }, tags: { amenity: 'hospital', name: 'East Clinic' } },
      { type: 'node', lat: 32.2, lon: -110.975, tags: { amenity: 'school', name: 'Far School' } },
    ] }
    const sites = sitesFromOverpass(json, 31.945, -110.975, 1500)
    expect(sites.map(s => s.name)).toEqual(['East Clinic', 'North School'])
    expect(sites[1].bearingDeg).toBe(0)
    expect(sites[0].bearingDeg).toBe(90)
    expect(sites[1].distanceM).toBeGreaterThan(950)
    expect(sites[1].distanceM).toBeLessThan(1050)
  })
})

describe('readingsFromCsv', () => {
  const mapping = {
    blockId: 'import', source: 'logger.csv', time: 'timestamp',
    levels: [
      { heightFt: 5, temp: 't_low_c', tempUnit: 'C' as const, wind: 'ws_low', windUnit: 'mps' as const, dir: 'wd_low' },
      { heightFt: 30, temp: 't_high_c', tempUnit: 'C' as const, wind: 'ws_high', windUnit: 'mps' as const, dir: 'wd_high' },
    ],
  }
  const csv = [
    'timestamp,t_low_c,t_high_c,ws_low,ws_high,wd_low,wd_high',
    '2026-11-17T05:00:00-07:00,10,14,1.5,2.2,280,265',
    '2026-11-17T05:05:00-07:00,10,oops,1.5,2.2,280,265',
  ].join('\n')
  it('converts rows and reports bad ones by line', () => {
    const { readings, errors } = readingsFromCsv(csv, mapping)
    expect(readings).toHaveLength(1)
    expect(readings[0].kind).toBe('recorded')
    expect(readings[0].levels[0]).toEqual({ heightFt: 5, tempF: 50, windMph: 3.4, windDirDeg: 280 })
    expect(readings[0].levels[1].tempF).toBe(57.2)
    expect(errors).toEqual(['line 3: t_high_c is not a number'])
  })
  it('summarises the statuses in a file', () => {
    const { readings } = readingsFromCsv(csv, mapping)
    expect(summarize(readings)).toEqual({ total: 1, GO: 0, CAUTION: 0, STOP: 1 })
  })
})

describe('backtest', () => {
  const H = 3_600_000
  const t0 = Date.parse('2025-01-10T00:00:00-07:00')
  const anchor = (h: number, t2: number, t80: number) => ({ timeMs: t0 + h * H, temp2mF: t2, temp80mF: t80, wind10Mph: 5, wind80Mph: 8, dir10Deg: 0, dir80Deg: 0, cloudPct: 0, isDay: false })
  const ground = (h: number, wind: number) => ({ station: 'az38', timeMs: t0 + h * H, tempF: 40, windMph: wind, windDirDeg: 0 })
  it('counts hours and nights the ground station missed', () => {
    const r = backtest(
      [ground(1, 5), ground(2, 1), ground(3, 5), ground(30, 5)],
      [anchor(1, 40, 45), anchor(2, 40, 45), anchor(3, 45, 40), anchor(30, 45, 40)],
    )
    expect(r.hoursCompared).toBe(4)
    expect(r.inversionHours).toBe(2)
    expect(r.missedHours).toBe(1)
    expect(r.nightsCompared).toBe(2)
    expect(r.missedNights).toEqual(['2025-01-09'])
  })
})
