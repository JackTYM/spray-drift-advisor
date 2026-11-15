/** Weather stations that report near the ground, and their latest observations. */

export interface Station { id: string; name: string; network: string; lat: number; lon: number; elevM: number }
export interface StationObs extends Station { timeMs: number; tempF: number; windMph: number; windDirDeg: number; rhPct?: number }

/** AZMet station locations, from the network's published station list (uace-azmet/azmetr). */
export const AZMET_STATIONS: Station[] = [
  { id: 'az01', name: 'Tucson', network: 'AZMet', lat: 32.2806, lon: -110.9459, elevM: 714 },
  { id: 'az02', name: 'Yuma Valley', network: 'AZMet', lat: 32.7118, lon: -114.7041, elevM: 36 },
  { id: 'az04', name: 'Safford', network: 'AZMet', lat: 32.813, lon: -109.6793, elevM: 903 },
  { id: 'az05', name: 'Coolidge', network: 'AZMet', lat: 32.98, lon: -111.6057, elevM: 423 },
  { id: 'az06', name: 'Maricopa', network: 'AZMet', lat: 33.0689, lon: -111.9722, elevM: 362 },
  { id: 'az07', name: 'Aguila', network: 'AZMet', lat: 33.9462, lon: -113.1865, elevM: 657 },
  { id: 'az08', name: 'Parker', network: 'AZMet', lat: 33.9643, lon: -114.4855, elevM: 98 },
  { id: 'az09', name: 'Bonita', network: 'AZMet', lat: 32.4775, lon: -109.9327, elevM: 1349 },
  { id: 'az12', name: 'Phoenix Greenway', network: 'AZMet', lat: 33.6233, lon: -112.1077, elevM: 403 },
  { id: 'az14', name: 'Yuma N.Gila', network: 'AZMet', lat: 32.7804, lon: -114.5163, elevM: 43 },
  { id: 'az15', name: 'Phoenix Encanto', network: 'AZMet', lat: 33.4784, lon: -112.098, elevM: 334 },
  { id: 'az16', name: 'Eloy', network: 'AZMet', lat: 32.7861, lon: -111.5594, elevM: 465 },
  { id: 'az19', name: 'Paloma', network: 'AZMet', lat: 32.9271, lon: -112.8967, elevM: 221 },
  { id: 'az20', name: 'Mohave', network: 'AZMet', lat: 34.9675, lon: -114.6111, elevM: 147 },
  { id: 'az22', name: 'Queen Creek', network: 'AZMet', lat: 33.1939, lon: -111.5326, elevM: 462 },
  { id: 'az23', name: 'Harquahala', network: 'AZMet', lat: 33.4907, lon: -113.1112, elevM: 348 },
  { id: 'az24', name: 'Roll', network: 'AZMet', lat: 32.7629, lon: -113.9675, elevM: 81 },
  { id: 'az26', name: 'Buckeye', network: 'AZMet', lat: 33.4092, lon: -112.6778, elevM: 301 },
  { id: 'az27', name: 'Desert Ridge', network: 'AZMet', lat: 33.6882, lon: -111.9634, elevM: 511 },
  { id: 'az28', name: 'Mohave-2', network: 'AZMet', lat: 34.8782, lon: -114.5668, elevM: 142 },
  { id: 'az32', name: 'Payson', network: 'AZMet', lat: 34.2325, lon: -111.345, elevM: 1479 },
  { id: 'az33', name: 'Bowie', network: 'AZMet', lat: 32.2891, lon: -109.4721, elevM: 1162 },
  { id: 'az35', name: 'Parker-2', network: 'AZMet', lat: 33.8557, lon: -114.4751, elevM: 92 },
  { id: 'az36', name: 'Yuma South', network: 'AZMet', lat: 32.5655, lon: -114.744, elevM: 28 },
  { id: 'az37', name: 'San Simon', network: 'AZMet', lat: 32.2001, lon: -109.1239, elevM: 1130 },
  { id: 'az38', name: 'Sahuarita', network: 'AZMet', lat: 31.9689, lon: -110.9456, elevM: 822 },
  { id: 'az39', name: 'Willcox Bench', network: 'AZMet', lat: 32.1181, lon: -109.7145, elevM: 1306 },
  { id: 'az40', name: 'Ft Mohave CA', network: 'AZMet', lat: 34.9691, lon: -114.645, elevM: 147 },
  { id: 'az41', name: 'Salome', network: 'AZMet', lat: 33.8485, lon: -113.5398, elevM: 585 },
  { id: 'az42', name: 'Wellton ETo', network: 'AZMet', lat: 32.6932, lon: -114.0674, elevM: 73 },
  { id: 'az43', name: 'Yuma Valley ETo', network: 'AZMet', lat: 32.7118, lon: -114.7041, elevM: 36 },
  { id: 'az44', name: 'Mohave ETo', network: 'AZMet', lat: 34.8951, lon: -114.6157, elevM: 145 },
  { id: 'az45', name: 'Chino Valley', network: 'AZMet', lat: 34.7842, lon: -112.4166, elevM: 1414 },
  { id: 'az46', name: 'Duncan', network: 'AZMet', lat: 32.7333, lon: -109.1164, elevM: 1109 },
  { id: 'az47', name: 'Elgin', network: 'AZMet', lat: 31.6606, lon: -110.5826, elevM: 1493 },
]

export const azmetAllLatestUrl = 'https://api.azmet.arizona.edu/v1/observations/15min/*/*/*'
/** Airport stations inside a box, from NOAA's Aviation Weather Center. */
export const metarUrl = (lat: number, lon: number, halfDeg = 1.5): string =>
  `https://aviationweather.gov/api/data/metar?bbox=${(lat - halfDeg).toFixed(2)},${(lon - halfDeg).toFixed(2)},${(lat + halfDeg).toFixed(2)},${(lon + halfDeg).toFixed(2)}&format=json`

const r1 = (n: number) => Math.round(n * 10) / 10

/** The newest reading from each AZMet station. Rows arrive newest first. Arizona time is UTC-7 all year. */
export function obsFromAzmetAll(json: any, maxAgeMs = 90 * 60_000, nowMs = Date.now()): StationObs[] {
  const out = new Map<string, StationObs>()
  for (const row of json?.data ?? []) {
    const st = AZMET_STATIONS.find(s => s.id === row.meta_station_id)
    if (!st || out.has(st.id)) continue
    const timeMs = Date.parse(`${String(row.datetime).replace(' ', 'T')}-07:00`)
    const tempC = Number(row.temp_airC), mps = Number(row.wind_spd_mps), dir = Number(row.wind_vector_dir), rh = Number(row.relative_humidity)
    if ([timeMs, tempC, mps, dir].some(Number.isNaN) || tempC < -60 || mps < 0 || dir < 0 || nowMs - timeMs > maxAgeMs) continue
    out.set(st.id, { ...st, timeMs, tempF: r1((tempC * 9) / 5 + 32), windMph: r1(mps * 2.23694), windDirDeg: Math.round(dir), ...(rh >= 0 && rh <= 100 ? { rhPct: Math.round(rh) } : {}) })
  }
  return [...out.values()]
}

/** Airport observations. Wind is in knots; a variable direction is reported as text and is kept as calm-direction 0. */
export function obsFromMetar(json: any, maxAgeMs = 90 * 60_000, nowMs = Date.now()): StationObs[] {
  const out: StationObs[] = []
  for (const m of Array.isArray(json) ? json : []) {
    const timeMs = typeof m.obsTime === 'number' ? m.obsTime * 1000 : Date.parse(m.reportTime ?? '')
    if (typeof m.temp !== 'number' || typeof m.wspd !== 'number' || typeof m.lat !== 'number' || typeof m.lon !== 'number' || Number.isNaN(timeMs) || nowMs - timeMs > maxAgeMs) continue
    out.push({
      id: m.icaoId, name: m.name?.split(',')[0] ?? m.icaoId, network: 'Airport', lat: m.lat, lon: m.lon, elevM: Number(m.elev) || 0, timeMs,
      tempF: r1((m.temp * 9) / 5 + 32), windMph: r1(m.wspd * 1.15078), windDirDeg: typeof m.wdir === 'number' ? m.wdir : 0,
    })
  }
  return out
}
