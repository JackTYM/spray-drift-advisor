import {
  BLOCKS, analyzeTerrain, azmetAllLatestUrl, distanceM, jobWindows, fuse, leaveOneOut, metarUrl, obsFromAzmetAll, obsFromMetar, planHours, residuals, terrainPoints,
  type FieldEstimate, type HourModel, type ModelNow, type PlanHour, type SensitiveSite, type Skill, type SprayWindow, type StationObs, type Terrain,
} from '@drift/engine'
import { cacheGet, cachePut, type Sql } from './db'

/**
 * The planner's data: every public near-ground station around the field, the weather model at each of
 * them and at the field, the terrain around the field, and from those the hours ahead that are sprayable.
 */

const HEADERS = { 'User-Agent': 'stillair-demo', Accept: 'application/json' }
const UNITS = 'temperature_unit=fahrenheit&wind_speed_unit=mph&timeformat=unixtime'
const HOURLY = 'temperature_2m,temperature_80m,wind_speed_10m,wind_speed_80m,wind_direction_10m,wind_direction_80m,wind_gusts_10m,relative_humidity_2m,cloud_cover,is_day'
/** Stations farther than this carry no weight, so the model is not asked about them. */
const STATION_RADIUS_KM = 160
const MAX_STATIONS = 24
/** AZMet measures wind at 3 m; the model and airports report 10 m. Power-law adjustment, exponent 0.15. */
const AZMET_WIND_TO_10M = Math.pow(10 / 3, 0.15)

const memo = new Map<string, { at: number; value: any }>()
/**
 * Fetches JSON, keeping the result in memory for a while; falls back to the database copy when the source is down.
 * Only finished results are kept: a Worker request must not wait on a fetch that another request started.
 */
async function getJson(sql: Sql, key: string, url: string, ttlMs: number): Promise<any> {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: HEADERS })
    if (!res.ok) throw new Error(`${res.status} from ${url}`)
    const value = await res.json()
    memo.set(key, { at: Date.now(), value })
    await cachePut(sql, key, value)
    return value
  } catch (err) {
    console.error('plan feed failed, using cache', key, err)
    return (await cacheGet(sql, key)) ?? null
  }
}

async function stationsNear(sql: Sql, lat: number, lon: number, nowMs: number): Promise<StationObs[]> {
  const boxLat = Math.round(lat * 2) / 2, boxLon = Math.round(lon * 2) / 2
  const [azmet, metar] = await Promise.all([
    getJson(sql, 'stations:azmet', azmetAllLatestUrl, 5 * 60_000),
    getJson(sql, `stations:metar:${boxLat},${boxLon}`, metarUrl(boxLat, boxLon, 1.75), 5 * 60_000),
  ])
  const all = [
    ...obsFromAzmetAll(azmet, 2 * 3_600_000, nowMs).map(o => ({ ...o, windMph: Math.round(o.windMph * AZMET_WIND_TO_10M * 10) / 10 })),
    ...obsFromMetar(metar, 2 * 3_600_000, nowMs),
  ]
  return all.map(o => ({ o, km: distanceM(lat, lon, o.lat, o.lon) / 1000 })).filter(x => x.km <= STATION_RADIUS_KM)
    .sort((a, b) => a.km - b.km).slice(0, MAX_STATIONS).map(x => x.o)
}

const list = (xs: number[]) => xs.map(x => x.toFixed(4)).join(',')

/** The model's current value at each point. Open-Meteo returns one object for one point and an array for several. */
async function modelNow(sql: Sql, key: string, pts: { lat: number; lon: number }[]): Promise<(ModelNow | null)[]> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${list(pts.map(p => p.lat))}&longitude=${list(pts.map(p => p.lon))}&current=temperature_2m,wind_speed_10m,wind_direction_10m&${UNITS}`
  const json = await getJson(sql, key, url, 5 * 60_000)
  const rows: any[] = Array.isArray(json) ? json : json ? [json] : []
  return pts.map((_, i) => {
    const c = rows[i]?.current
    return c && typeof c.temperature_2m === 'number' ? { tempF: c.temperature_2m, windMph: c.wind_speed_10m, windDirDeg: c.wind_direction_10m } : null
  })
}

async function fieldHours(sql: Sql, key: string, lat: number, lon: number): Promise<HourModel[]> {
  const json = await getJson(sql, key, `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=${HOURLY}&${UNITS}&past_hours=1&forecast_hours=49`, 10 * 60_000)
  const h = json?.hourly
  if (!h?.time) return []
  const out: HourModel[] = []
  for (let i = 0; i < h.time.length; i++) {
    const v = [h.temperature_2m[i], h.temperature_80m[i], h.wind_speed_10m[i], h.wind_speed_80m[i], h.wind_direction_10m[i], h.wind_direction_80m[i], h.cloud_cover[i]]
    if (v.some(x => typeof x !== 'number')) continue
    out.push({
      timeMs: h.time[i] * 1000, temp2mF: v[0], temp80mF: v[1], wind10Mph: v[2], wind80Mph: v[3], dir10Deg: v[4], dir80Deg: v[5], cloudPct: v[6], isDay: h.is_day[i] === 1,
      gustMph: h.wind_gusts_10m[i] ?? v[2], rhPct: h.relative_humidity_2m[i] ?? 0,
    })
  }
  return out
}

/** Ground elevation around the field. It does not change, so the database copy is used when there is one. */
async function fieldTerrain(sql: Sql, key: string, lat: number, lon: number): Promise<Terrain | null> {
  const dbKey = `terrain:${key}`
  let elevs: number[] | undefined = (await cacheGet(sql, dbKey))?.elevation
  if (!elevs) {
    const pts = terrainPoints(lat, lon)
    elevs = (await getJson(sql, dbKey, `https://api.open-meteo.com/v1/elevation?latitude=${list(pts.map(p => p.lat))}&longitude=${list(pts.map(p => p.lon))}`, 3_600_000))?.elevation
  }
  return Array.isArray(elevs) && elevs.length === 25 ? analyzeTerrain(elevs) : null
}

/**
 * Buildings within 150 m of each block's edge, grouped by their bearing from the block centre in 15 degree steps.
 * Counted once from the Microsoft building footprints the 3D view draws (apps/web/public/buildings.json).
 * An hour whose wind blows toward any of them is closed, the same test the 3D view uses to mark buildings.
 */
const NEIGHBOURS: Record<string, { bearingDeg: number; count: number; edgeM: number }[]> = {"block-1": [], "block-2": [], "block-3": [{"bearingDeg": 0, "count": 1, "edgeM": 53}, {"bearingDeg": 15, "count": 4, "edgeM": 63}, {"bearingDeg": 30, "count": 3, "edgeM": 15}]}
const neighbours = (blockId: string): SensitiveSite[] => (NEIGHBOURS[blockId] ?? []).map(n => ({
  name: `buildings ${n.edgeM} m from the edge of this block`, type: 'building', bearingDeg: n.bearingDeg, distanceM: n.edgeM,
}))

export interface Plan {
  field: { id: string; name: string; lat: number; lon: number }
  generatedMs: number
  /** True when the hours ahead are the scripted example day, not the live forecast. */
  example: boolean
  jobMinutes: number
  terrain: Terrain
  estimate: FieldEstimate
  /** Accuracy test across the stations in range, right now. */
  skill: Skill
  /** Typical error used for confidence, °F and mph. */
  sigma: { tempF: number; windMph: number }
  stations: (StationObs & { modelTempF: number; modelWindMph: number })[]
  hours: PlanHour[]
  windows: SprayWindow[]
  sites: SensitiveSite[]
}

/**
 * A scripted, typical clear autumn day for demonstrations, in place of the live forecast: an inversion overnight that
 * breaks mid-morning, a steady morning window, a windy afternoon, and an evening hour with the wind swinging round.
 * Stations and terrain stay real. The plan is marked as an example and the page says so.
 */
function exampleHours(nowMs: number): HourModel[] {
  const start = Math.floor(nowMs / 3_600_000) * 3_600_000
  return Array.from({ length: 49 }, (_, i) => {
    const timeMs = start + i * 3_600_000
    const h = new Date(timeMs - 7 * 3_600_000).getUTCHours() // Arizona time
    const night = h >= 19 || h < 7
    const [gradient, wind, from] = night ? [7 + ((h + 5) % 12) * 0.3, 3.5, 150]
      : h < 9 ? [3 - (h - 7) * 1.2, 4.5, 60]
      : h < 13 ? [-1.6, 7.5, 20]
      : h < 15 ? [-2, 13, 250]
      : h < 17 ? [-1.6, 8, 215] // inside the limits, but blowing toward the buildings north-east of Block 3
      : h < 18 ? [-1.2, 7.5, 20]
      : [-0.4, 7, 215]
    const temp = night ? 48 : 58 + Math.min(h - 7, 8) * 2
    return { timeMs, temp2mF: temp, temp80mF: temp + gradient, wind10Mph: wind, wind80Mph: wind * 1.5, dir10Deg: from, dir80Deg: (from + 10) % 360, cloudPct: 5, isDay: !night, gustMph: wind * 1.3, rhPct: 35 }
  })
}

export async function buildPlan(sql: Sql, f: { id: string; name: string; lat: number; lon: number }, jobMinutes: number, example = false): Promise<Plan | { error: string }> {
  const nowMs = Date.now()
  const key = `${f.lat.toFixed(3)},${f.lon.toFixed(3)}`
  const [obs, liveHours, terrain] = await Promise.all([stationsNear(sql, f.lat, f.lon, nowMs), fieldHours(sql, `plan-hours:${key}`, f.lat, f.lon), fieldTerrain(sql, key, f.lat, f.lon)])
  const hours = example ? exampleHours(nowMs) : liveHours
  if (!hours.length) return { error: 'The weather model is not reachable right now.' }
  if (!terrain) return { error: 'Terrain data is not reachable right now.' }

  const models = await modelNow(sql, `plan-model:${key}`, [{ lat: f.lat, lon: f.lon }, ...obs])
  const fieldModel = models[0]
  if (!fieldModel) return { error: 'The weather model is not reachable right now.' }
  const pairs = obs.map((o, i) => ({ o, m: models[i + 1] })).filter((p): p is { o: StationObs; m: ModelNow } => p.m !== null)
  const res = residuals(pairs.map(p => p.o), pairs.map(p => p.m))
  const estimate = fuse({ lat: f.lat, lon: f.lon, elevM: terrain.elevM }, fieldModel, res)
  const skill = leaveOneOut(res)
  // Mean absolute error to standard deviation for a normal error is a factor of 1.25. With too few stations, assume a cautious default.
  const sigma = skill.n >= 4 ? { tempF: Math.max(skill.fusedTempF * 1.25, 1), windMph: Math.max(skill.fusedWindMph * 1.25, 1) } : { tempF: 3, windMph: 2.5 }

  const block = BLOCKS.find(b => distanceM(b.lat, b.lon, f.lat, f.lon) < 300)
  const sites = block ? [...block.sites, ...neighbours(block.id)] : []
  const planned = planHours({ ...f, sites, terrain, hours, nowMs, correction: example ? { dTempF: 0, dWindMph: 0 } : estimate.correction, sigma, support: estimate.support })
  return {
    field: f, generatedMs: nowMs, jobMinutes, example, terrain, estimate, skill, sigma: { tempF: Math.round(sigma.tempF * 10) / 10, windMph: Math.round(sigma.windMph * 10) / 10 },
    stations: pairs.map(p => ({ ...p.o, modelTempF: p.m.tempF, modelWindMph: p.m.windMph })),
    hours: planned, windows: jobWindows(planned, jobMinutes, { nowMs }), sites,
  }
}

/** A finished plan is good for a few minutes: stations report every 15 minutes and the forecast hourly. */
const PLAN_TTL_MS = 5 * 60_000
const planMemo = new Map<string, Plan>()

/** The plan for a field, from memory or the database when one was made in the last few minutes, otherwise built now. */
export async function cachedPlan(sql: Sql, f: { id: string; name: string; lat: number; lon: number }, jobMinutes: number, keep: (p: Promise<unknown>) => void, example = false): Promise<Plan | { error: string }> {
  const key = `plan${example ? '-example' : ''}:${f.lat.toFixed(4)},${f.lon.toFixed(4)}`
  const fresh = (p: Plan | undefined | null): p is Plan => !!p && Date.now() - p.generatedMs < PLAN_TTL_MS
  const dress = (p: Plan): Plan => ({ ...p, field: f, jobMinutes, windows: jobWindows(p.hours, jobMinutes, { nowMs: Date.now() }) })
  const inMemory = planMemo.get(key)
  if (fresh(inMemory)) return dress(inMemory)
  const stored = (await cacheGet(sql, key).catch(() => null)) as Plan | null
  if (fresh(stored)) { planMemo.set(key, stored); return dress(stored) }
  const built = await buildPlan(sql, f, jobMinutes, example)
  if (!('error' in built)) { planMemo.set(key, built); keep(cachePut(sql, key, built).catch(() => null)) }
  return built
}
