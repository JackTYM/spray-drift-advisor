import {
  RANCH, anchorsFromOpenMeteo, azmetHourlyUrl, azmetLatestUrl, groundFromAzmet, openMeteoHistoryUrl, openMeteoUrl, overpassQuery, sitesFromOverpass,
  type Anchor, type BlockModel, type GroundObs, type SensitiveSite,
} from '@drift/engine'
import { cacheGet, cachePut, type Sql } from './db'

const HEADERS = { 'User-Agent': 'spray-drift-advisor-demo', Accept: 'application/json' }

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
  const json = await fetchCached(sql, `sites:${block.id}`, 'https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery(block.lat, block.lon, 1500))}`,
  })
  return json ? sitesFromOverpass(json, block.lat, block.lon, 1500) : null
}
