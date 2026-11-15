import {
  COMPASS, RANCH, addressesFromPima, anchorsFromOpenMeteo, cdlUrl, elevationUrl, isLowGround, offsetPoint, parseCdl, pimaAddressUrl, azmetHourlyUrl, azmetLatestUrl, groundFromAzmet, openMeteoHistoryUrl, openMeteoUrl, overpassQuery, sitesFromOverpass,
  type Anchor, type BlockModel, type GroundObs, type SensitiveSite, type Surroundings,
} from '@drift/engine'
import { cacheGet, cachePut, type Sql } from './db'

const HEADERS = { 'User-Agent': 'stillair-demo', Accept: 'application/json' }

/** Fetches JSON and caches it; falls back to the cached copy when the source is down. */
async function fetchCached(sql: Sql, key: string, url: string, init?: RequestInit): Promise<any> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000), headers: { ...HEADERS, ...(init?.headers ?? {}) } })
    if (!res.ok) throw new Error(`${res.status} from ${url}`)
    const json = await res.json()
    await cachePut(sql, key, json)
    return json
  } catch (err) {
    console.error('feed failed, using cache', key, err)
    return (await cacheGet(sql, key)) ?? null
  }
}

export const liveAnchors = async (sql: Sql): Promise<Anchor[]> =>
  anchorsFromOpenMeteo(await fetchCached(sql, 'forecast', openMeteoUrl(RANCH.lat, RANCH.lon)))

export async function liveGround(sql: Sql): Promise<GroundObs | null> {
  const json = await fetchCached(sql, 'ground-latest', azmetLatestUrl(RANCH.groundStation))
  const row = json?.data?.[0]
  return row ? groundFromAzmet(row, RANCH.groundStation) : null
}

const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

export const historyAnchors = async (sql: Sql, date: string): Promise<Anchor[]> =>
  anchorsFromOpenMeteo(await fetchCached(sql, `history:${date}`, openMeteoHistoryUrl(RANCH.lat, RANCH.lon, date, nextDay(date))))

export async function historyGround(sql: Sql, date: string): Promise<GroundObs[]> {
  const json = await fetchCached(sql, `ground:${date}`, azmetHourlyUrl(RANCH.groundStation, `${date}T00:00`, 2))
  const rows: Record<string, string>[] = json?.data ?? []
  return rows.map(r => groundFromAzmet(r, RANCH.groundStation)).filter((g): g is GroundObs => g !== null).sort((a, b) => a.timeMs - b.timeMs)
}

/** Returns null when Overpass is unreachable and nothing is cached, so the caller can retry later. */
export async function blockSites(sql: Sql, block: BlockModel): Promise<SensitiveSite[] | null> {
  const json = await fetchCached(sql, `sites:${block.id}:${block.lat},${block.lon}`, 'https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery(block.lat, block.lon, 1500))}`,
  })
  return json ? sitesFromOverpass(json, block.lat, block.lon, 1500) : null
}

// ---------- What surrounds a block: addresses, neighbouring crops, terrain ----------

const SURROUND_M = 400
const ADDRESS_RADIUS_M = 1000
const CDL_YEAR = 2024

async function getQuiet(url: string, as: 'json' | 'text'): Promise<any> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: HEADERS })
    return res.ok ? await res[as]() : null
  } catch {
    return null
  }
}

/** Fetched once per block and cached: none of this changes during a spray season. */
export async function blockSurroundings(sql: Sql, block: BlockModel): Promise<Surroundings> {
  const key = `surroundings:${block.id}:${block.lat},${block.lon}`
  const cached = await cacheGet(sql, key)
  if (cached) return cached as Surroundings

  const ring = COMPASS.map((dir, i) => ({ dir, bearingDeg: i * 45, ...offsetPoint(block.lat, block.lon, i * 45, SURROUND_M) }))
  const [addr, centerCrop, crops, centerFt, aroundFt] = await Promise.all([
    getQuiet(pimaAddressUrl(block.lat, block.lon, ADDRESS_RADIUS_M), 'json'),
    getQuiet(cdlUrl(CDL_YEAR, block.lat, block.lon), 'text'),
    Promise.all(ring.map(p => getQuiet(cdlUrl(CDL_YEAR, p.lat, p.lon), 'text'))),
    getQuiet(elevationUrl(block.lat, block.lon), 'json'),
    Promise.all(ring.filter((_, i) => i % 2 === 0).map(p => getQuiet(elevationUrl(p.lat, p.lon), 'json'))),
  ])
  const feet = (j: any): number | null => (typeof j?.value === 'number' ? Math.round(j.value * 10) / 10 : null)
  const around = aroundFt.map(feet).filter((v): v is number => v !== null)
  const elevationFt = feet(centerFt)
  const out: Surroundings = {
    blockId: block.id,
    addresses: addressesFromPima(addr, block.lat, block.lon, ADDRESS_RADIUS_M),
    centerCrop: centerCrop ? parseCdl(centerCrop) : null,
    crops: ring.map((p, i) => ({ ...p, category: crops[i] ? parseCdl(crops[i]) : null })),
    elevationFt,
    aroundFt: around,
    lowGround: elevationFt !== null && around.length ? isLowGround(elevationFt, around) : null,
    fetchedMs: Date.now(),
  }
  // Cache only a complete answer, so a source that was down is retried next time.
  if (addr && out.crops.every(c => c.category) && elevationFt !== null) await cachePut(sql, key, out)
  return out
}
