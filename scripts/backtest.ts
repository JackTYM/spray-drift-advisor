import { neon } from '@neondatabase/serverless'
import { RANCH, anchorsFromOpenMeteo, azmetHourlyUrl, backtest, groundFromAzmet, openMeteoHistoryUrl, type Anchor, type GroundObs } from '@drift/engine'

const year = Number(process.argv[2] ?? 2025)
const headers = { 'User-Agent': 'stillair-demo', Accept: 'application/json' }
const pad = (n: number) => String(n).padStart(2, '0')

/** Both services return occasional 502s; retry before giving up. */
async function getJson(url: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers })
    if (res.ok) return res.json()
    if (attempt === 4) throw new Error(`${res.status} from ${url}`)
    await new Promise(r => setTimeout(r, attempt * 3000))
  }
}

const ground: GroundObs[] = []
const anchors: Anchor[] = []
for (let month = 1; month <= 12; month++) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const start = `${year}-${pad(month)}-01`
  const end = `${year}-${pad(month)}-${pad(days)}`
  const az = await getJson(azmetHourlyUrl(RANCH.groundStation, `${start}T00:00`, days))
  for (const row of az.data ?? []) {
    const g = groundFromAzmet(row, RANCH.groundStation)
    if (g) ground.push(g)
  }
  anchors.push(...anchorsFromOpenMeteo(await getJson(openMeteoHistoryUrl(RANCH.lat, RANCH.lon, start, end))))
  console.log(`${start}: ${ground.length} ground hours, ${anchors.length} profile hours so far`)
}

const result = backtest(ground, anchors)
console.log({ ...result, missedNights: result.missedNights.length })
console.log('First missed nights (use one as the replay date):', result.missedNights.slice(0, 10))

if (process.env.DATABASE_URL) {
  const sql = neon(process.env.DATABASE_URL)
  const label = `${RANCH.groundStationName} vs Open-Meteo historical profile, ${year}`
  await sql`insert into backtest_results (label, result) values (${label}, ${JSON.stringify(result)}::jsonb)`
  console.log('Saved to backtest_results.')
} else {
  console.log('DATABASE_URL is not set; result was not saved.')
}
