import { describe, expect, it } from 'vitest'
import {
  analyzeTerrain, confidenceWord, findWindows, fuse, leaveOneOut, normalCdf, obsFromAzmetAll, obsFromMetar, planHours, residuals, terrainPoints, towerModelFor,
  type HourModel, type StationObs,
} from '../src'

const T0 = Date.parse('2026-11-16T00:00:00-07:00')
const H = 3_600_000
const station = (id: string, lat: number, lon: number, elevM: number, tempF: number, windMph: number, windDirDeg = 270): StationObs =>
  ({ id, name: id, network: 'AZMet', lat, lon, elevM, timeMs: T0, tempF, windMph, windDirDeg })

describe('station observations', () => {
  it('keeps the newest reading per AZMet station and converts units', () => {
    const json = { data: [
      { meta_station_id: 'az38', datetime: '2026-11-15 23:49:00', temp_airC: '10.0', wind_spd_mps: '2.0', wind_vector_dir: '180', relative_humidity: '60' },
      { meta_station_id: 'az38', datetime: '2026-11-15 23:34:00', temp_airC: '12.0', wind_spd_mps: '3.0', wind_vector_dir: '180', relative_humidity: '55' },
      { meta_station_id: 'zz99', datetime: '2026-11-15 23:49:00', temp_airC: '10.0', wind_spd_mps: '2.0', wind_vector_dir: '180' },
    ] }
    const obs = obsFromAzmetAll(json, 90 * 60_000, T0)
    expect(obs).toHaveLength(1)
    expect(obs[0]).toMatchObject({ id: 'az38', name: 'Sahuarita', tempF: 50, windMph: 4.5, windDirDeg: 180, rhPct: 60, elevM: 822 })
  })
  it('reads airport observations in knots and Celsius', () => {
    const obs = obsFromMetar([{ icaoId: 'KTUS', name: 'Tucson Intl, AZ, US', lat: 32.13, lon: -110.95, elev: 779, obsTime: T0 / 1000, temp: 20, wspd: 10, wdir: 'VRB' }], 90 * 60_000, T0)
    expect(obs[0]).toMatchObject({ id: 'KTUS', name: 'Tucson Intl', network: 'Airport', tempF: 68, windMph: 11.5, windDirDeg: 0 })
  })
})

describe('station-corrected estimate', () => {
  const model = { tempF: 50, windMph: 5, windDirDeg: 270 }
  it('moves the field toward a nearby station that disagrees with the model', () => {
    const near = station('near', 31.96, -110.95, 820, 44, 2)
    const far = station('far', 33.4, -112.1, 330, 50, 5)
    const est = fuse({ lat: 31.954, lon: -110.954, elevM: 829 }, model, residuals([near, far], [model, model]))
    expect(est.tempF).toBeLessThan(45)
    expect(est.windMph).toBeLessThan(3)
    expect(est.stations[0]).toMatchObject({ id: 'near' })
    expect(est.stations[0]!.weight).toBeGreaterThan(0.9)
    expect(est.support).toBeGreaterThan(0.9)
  })
  it('falls back to the model when every station is far away or at another elevation', () => {
    const est = fuse({ lat: 31.954, lon: -110.954, elevM: 829 }, model, residuals([station('far', 34.9, -114.6, 147, 40, 1)], [model]))
    expect(est.support).toBeLessThan(0.05)
    expect(est.tempF).toBeCloseTo(50, 0)
  })
  it('trusts a station at the same elevation over a closer one much higher up', () => {
    const level = station('level', 32.05, -110.954, 830, 44, 5)
    const hill = station('hill', 31.99, -110.954, 1500, 56, 5)
    const est = fuse({ lat: 31.954, lon: -110.954, elevM: 829 }, model, residuals([level, hill], [model, model]))
    expect(est.stations[0]!.id).toBe('level')
    expect(est.tempF).toBeLessThan(49)
  })
  it('scores better than the model alone when stations share a bias', () => {
    const list = [0, 1, 2, 3, 4].map(i => station(`s${i}`, 32 + i * 0.1, -111 + i * 0.1, 800, 46, 3))
    const skill = leaveOneOut(residuals(list, list.map(() => model)))
    expect(skill.n).toBe(5)
    expect(skill.modelTempF).toBe(4)
    expect(skill.fusedTempF).toBeLessThan(1.5)
    expect(skill.fusedWindMph).toBeLessThan(skill.modelWindMph)
  })
})

describe('terrain', () => {
  const grid = (centre: number, r500: number, r2k: number, r6k: number) => [centre, ...Array(8).fill(r500), ...Array(8).fill(r2k), ...Array(8).fill(r6k)]
  it('asks for the centre and three rings of eight points', () => {
    expect(terrainPoints(31.95, -110.95)).toHaveLength(25)
  })
  it('recognises a field in a dip', () => {
    const t = analyzeTerrain(grid(800, 803, 815, 830))
    expect(t.kind).toBe('low ground')
    expect(t.coldPool).toBe(1)
    expect(t.summary).toContain('below')
  })
  it('recognises a valley floor from the wider ring', () => {
    const t = analyzeTerrain(grid(800, 800, 803, 850))
    expect(t.kind).toBe('valley floor')
    expect(t.coldPool).toBeGreaterThanOrEqual(0.5)
  })
  it('recognises high ground and gives it no cold pooling', () => {
    const t = analyzeTerrain(grid(860, 855, 840, 820))
    expect(t.kind).toBe('high ground')
    expect(t.coldPool).toBe(0)
  })
  it('finds which way a slope drains', () => {
    // Higher to the south (index 4 of each ring), lower to the north (index 0).
    const ring = [780, 790, 800, 810, 820, 810, 800, 790]
    const t = analyzeTerrain([800, ...ring.map(v => 800 + (v - 800) / 4), ...ring, ...Array(8).fill(800)])
    expect(t.drainsToward).toBe('N')
    expect(t.kind).toBe('slope')
  })
  it('makes inversions start sooner and run stronger where cold air pools', () => {
    const low = towerModelFor(analyzeTerrain(grid(800, 803, 815, 830)))
    const flat = towerModelFor(analyzeTerrain(grid(800, 800, 800, 800)))
    expect(low.offsetF).toBeLessThan(flat.offsetF)
    expect(low.factor).toBeGreaterThan(flat.factor)
  })
})

describe('planner', () => {
  const hour = (i: number, gradientF: number, wind: number, isDay: boolean): HourModel => ({
    timeMs: T0 + i * H, temp2mF: 50, temp80mF: 50 + gradientF, wind10Mph: wind, wind80Mph: wind * 1.4, dir10Deg: 200, dir80Deg: 210,
    cloudPct: 5, isDay, gustMph: wind * 1.3, rhPct: 50,
  })
  // Calm and inverted until hour 7, then a mixed, breezy day until hour 16, then too windy.
  const hours = Array.from({ length: 24 }, (_, i) => (i < 8 ? hour(i, 9, 6, false) : i < 17 ? hour(i, -1.4, 7.5, true) : hour(i, -1.4, 16, true)))
  const terrain = analyzeTerrain([800, ...Array(24).fill(800)])
  const plan = planHours({ id: 'f', name: 'Field', lat: 31.95, lon: -110.95, sites: [], terrain, hours, nowMs: T0, correction: { dTempF: 0, dWindMph: 0 }, sigma: { tempF: 1.5, windMph: 1.2 }, support: 0.9 })

  it('is not sprayable during the inversion or the wind, and is in between', () => {
    expect(plan[2]!.status).toBe('STOP')
    expect(plan[10]!.status).toBe('GO')
    expect(plan[20]!.status).toBe('STOP')
  })
  it('is confident mid-window and unsure at its edges and far ahead', () => {
    expect(plan[10]!.confidence).toBeGreaterThan(0.75)
    expect(plan[2]!.confidence).toBeLessThan(0.2)
    expect(plan[20]!.confidence).toBeLessThan(0.2)
  })
  it('finds the window long enough for the job, with the latest start that still finishes', () => {
    const w = findWindows(plan, 45)
    expect(w).toHaveLength(1)
    expect(w[0]!.startMs).toBe(T0 + 8 * H)
    expect(w[0]!.endMs).toBe(T0 + 17 * H)
    expect(w[0]!.latestStartMs).toBe(T0 + 17 * H - 45 * 60_000)
  })
  it('rejects a window shorter than the job', () => {
    const short = planHours({ id: 'f', name: 'Field', lat: 31.95, lon: -110.95, sites: [], terrain, nowMs: T0, correction: { dTempF: 0, dWindMph: 0 }, sigma: { tempF: 1.5, windMph: 1.2 }, support: 0.9,
      hours: Array.from({ length: 6 }, (_, i) => (i === 2 ? hour(i, -1.4, 6.5, true) : hour(i, 9, 6, false))) })
    expect(findWindows(short, 45)).toHaveLength(1)
    expect(findWindows(short, 90)).toHaveLength(0)
  })
  it('applies the station correction now and lets it fade', () => {
    const corrected = planHours({ id: 'f', name: 'Field', lat: 31.95, lon: -110.95, sites: [], terrain, hours, nowMs: T0, correction: { dTempF: -4, dWindMph: 0 }, sigma: { tempF: 1.5, windMph: 1.2 }, support: 0.9 })
    const drop = (i: number) => plan[i]!.reading.levels[0]!.tempF - corrected[i]!.reading.levels[0]!.tempF
    expect(drop(0)).toBeCloseTo(4, 1)
    expect(drop(12)).toBeCloseTo(1, 1)
  })
  it('gives sensible probabilities and words', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 5)
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3)
    expect([0.9, 0.6, 0.3].map(confidenceWord)).toEqual(['high', 'moderate', 'low'])
  })
})
