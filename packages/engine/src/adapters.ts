import { evaluate } from './evaluate'
import type { Anchor } from './tower'
import type { GroundObs, Reading, SensitiveSite, Status } from './types'

const r1 = (n: number) => Math.round(n * 10) / 10

// ---------- Open-Meteo ----------

const HOURLY = 'temperature_2m,temperature_80m,wind_speed_10m,wind_speed_80m,wind_direction_10m,wind_direction_80m,cloud_cover,is_day'
const UNITS = 'temperature_unit=fahrenheit&wind_speed_unit=mph&timeformat=unixtime'

export const openMeteoUrl = (lat: number, lon: number): string =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${HOURLY}&${UNITS}&past_days=1&forecast_days=3`

/** Dates are YYYY-MM-DD. */
export const openMeteoHistoryUrl = (lat: number, lon: number, start: string, end: string): string =>
  `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${HOURLY}&${UNITS}&start_date=${start}&end_date=${end}`

export function anchorsFromOpenMeteo(json: any): Anchor[] {
  const h = json?.hourly
  if (!h?.time) return []
  const out: Anchor[] = []
  for (let i = 0; i < h.time.length; i++) {
    const v = [h.temperature_2m[i], h.temperature_80m[i], h.wind_speed_10m[i], h.wind_speed_80m[i], h.wind_direction_10m[i], h.wind_direction_80m[i], h.cloud_cover[i]]
    if (v.some(x => typeof x !== 'number')) continue
    out.push({ timeMs: h.time[i] * 1000, temp2mF: v[0], temp80mF: v[1], wind10Mph: v[2], wind80Mph: v[3], dir10Deg: v[4], dir80Deg: v[5], cloudPct: v[6], isDay: h.is_day[i] === 1 })
  }
  return out
}

// ---------- AZMet ----------

export const azmetLatestUrl = (station: string): string => `https://api.azmet.arizona.edu/v1/observations/15min/${station}/*/*`

/** startLocal is YYYY-MM-DDTHH:MM in Arizona time. */
export const azmetHourlyUrl = (station: string, startLocal: string, days: number): string =>
  `https://api.azmet.arizona.edu/v1/observations/hourly/${station}/${startLocal}/P${days}DT0H`

export function groundFromAzmet(row: Record<string, string>, station: string): GroundObs | null {
  const stamp = row.datetime ?? row.date_datetime
  if (!stamp) return null
  const timeMs = Date.parse(`${stamp.replace(' ', 'T')}-07:00`)
  const tempF = row.temp_airF !== undefined ? Number(row.temp_airF) : (Number(row.temp_airC) * 9) / 5 + 32
  const windMph = row.wind_spd_mph !== undefined ? Number(row.wind_spd_mph) : Number(row.wind_spd_mps) * 2.23694
  const windDirDeg = Number(row.wind_vector_dir)
  if ([timeMs, tempF, windMph, windDirDeg].some(Number.isNaN) || tempF < -100 || windMph < 0 || windDirDeg < 0) return null
  const rh = Number(row.relative_humidity)
  const out: GroundObs = { station, timeMs, tempF: r1(tempF), windMph: r1(windMph), windDirDeg: Math.round(windDirDeg) }
  if (row.relative_humidity !== undefined && rh >= 0 && rh <= 100) out.rhPct = Math.round(rh)
  return out
}

// ---------- Overpass (OpenStreetMap) ----------

export const overpassQuery = (lat: number, lon: number, radiusM: number): string =>
  `[out:json][timeout:25];nwr["amenity"~"school|kindergarten|hospital"](around:${radiusM},${lat},${lon});out center 30;`

const rad = (d: number) => (d * Math.PI) / 180

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2
  return 6_371_000 * 2 * Math.asin(Math.sqrt(a))
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2))
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1))
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360) % 360
}

export function sitesFromOverpass(json: any, lat: number, lon: number, maxM: number): SensitiveSite[] {
  const out: SensitiveSite[] = []
  for (const e of json?.elements ?? []) {
    const p = e.center ?? e
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue
    const d = distanceM(lat, lon, p.lat, p.lon)
    if (d > maxM) continue
    const type = e.tags?.amenity ?? 'site'
    out.push({ name: e.tags?.name ?? `a nearby ${type}`, type, bearingDeg: bearingDeg(lat, lon, p.lat, p.lon), distanceM: Math.round(d) })
  }
  return out.sort((a, b) => a.distanceM - b.distanceM)
}

// ---------- CSV ----------

export interface CsvLevelMapping { heightFt: number; temp: string; tempUnit: 'F' | 'C'; wind: string; windUnit: 'mph' | 'mps'; dir: string }
export interface CsvMapping { blockId: string; source: string; time: string; levels: CsvLevelMapping[] }

/** Plain comma-separated text with a header row. Quoted fields are not supported. */
export function readingsFromCsv(text: string, m: CsvMapping): { readings: Reading[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')
  const header = lines[0].split(',').map(s => s.trim())
  const col = (name: string) => header.indexOf(name)
  const readings: Reading[] = []
  const errors: string[] = []
  const missing = [m.time, ...m.levels.flatMap(l => [l.temp, l.wind, l.dir])].filter(c => col(c) < 0)
  if (missing.length) return { readings, errors: [`missing columns: ${missing.join(', ')}`] }

  rows: for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(s => s.trim())
    const timeMs = Date.parse(cells[col(m.time)])
    if (Number.isNaN(timeMs)) { errors.push(`line ${i + 1}: ${m.time} is not a timestamp`); continue }
    const levels = []
    for (const l of m.levels) {
      const vals: Record<string, number> = {}
      for (const c of [l.temp, l.wind, l.dir]) {
        const n = Number(cells[col(c)])
        if (cells[col(c)] === '' || Number.isNaN(n)) { errors.push(`line ${i + 1}: ${c} is not a number`); continue rows }
        vals[c] = n
      }
      levels.push({
        heightFt: l.heightFt,
        tempF: r1(l.tempUnit === 'C' ? (vals[l.temp] * 9) / 5 + 32 : vals[l.temp]),
        windMph: r1(l.windUnit === 'mps' ? vals[l.wind] * 2.23694 : vals[l.wind]),
        windDirDeg: Math.round(vals[l.dir]),
      })
    }
    readings.push({ source: m.source, kind: 'recorded', blockId: m.blockId, time: new Date(timeMs).toISOString(), levels })
  }
  return { readings, errors }
}

/** Runs every reading through the rules and counts the statuses. */
export function summarize(readings: Reading[]): { total: number } & Record<Status, number> {
  const out = { total: readings.length, GO: 0, CAUTION: 0, STOP: 0 }
  const sorted = [...readings].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  for (let i = 0; i < sorted.length; i++) {
    out[evaluate({ history: sorted.slice(Math.max(0, i - 19), i + 1), nowMs: Date.parse(sorted[i].time), sites: [] }).status]++
  }
  return out
}
