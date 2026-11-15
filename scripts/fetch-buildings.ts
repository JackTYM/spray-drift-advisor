// One-off: fetches real building outlines around each block from OpenStreetMap and writes them
// into the web app as a static file. Overpass can take 40 s per query, so this is not done live.
// Run again after moving a block: pnpm --filter @drift/scripts buildings
import { writeFileSync } from 'node:fs'
import { BLOCKS, buildingsFromOverpass, buildingsQuery, type Building } from '@drift/engine'

const out: Record<string, Building[]> = {}
for (const b of BLOCKS) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'spray-drift-advisor-demo' },
      body: `data=${encodeURIComponent(buildingsQuery(b.lat, b.lon, 900))}`,
      signal: AbortSignal.timeout(120_000),
    }).catch(() => null)
    if (res?.ok) { out[b.id] = buildingsFromOverpass(await res.json(), b.lat, b.lon); break }
    if (attempt === 4) throw new Error(`Overpass failed for ${b.id}: ${res?.status ?? 'no response'}`)
    await new Promise(r => setTimeout(r, attempt * 5000))
  }
  console.log(b.id, out[b.id]!.length, 'buildings')
}
writeFileSync(new URL('../apps/web/public/buildings.json', import.meta.url), JSON.stringify(out))
