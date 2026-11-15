// One-off: fetches real building outlines around each block and writes them into the web app
// as a static file. Source: Microsoft's open Global ML Building Footprints, which are traced by
// machine from aerial imagery and are far more complete here than OpenStreetMap.
// Run again after moving a block: pnpm --filter @drift/scripts buildings
import { writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { BLOCKS, buildingFromRing, quadkey } from '@drift/engine'

const RADIUS_M = 2500
const INDEX = 'https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv'

// The blocks sit near a tile edge, so collect every tile that a block's search radius touches.
const pad = (RADIUS_M / 111_320) * 1.3
const keys = new Set<string>()
for (const b of BLOCKS) for (const dLat of [-pad, pad]) for (const dLon of [-pad, pad]) keys.add(quadkey(b.lat + dLat, b.lon + dLon, 9))
const index = await (await fetch(INDEX)).text()
const urls = index.split('\n').map(l => l.split(',')).filter(c => c[0] === 'UnitedStates' && keys.has(c[1]!)).map(c => c[2]!)
if (!urls.length) throw new Error(`No building files for tiles ${[...keys].join(', ')}`)

const rings: { ring: [number, number][]; height: number }[] = []
for (const url of urls) {
  const lines = gunzipSync(Buffer.from(await (await fetch(url)).arrayBuffer())).toString('utf8').split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    const f = JSON.parse(line)
    if (f.geometry?.type === 'Polygon') rings.push({ ring: f.geometry.coordinates[0], height: f.properties?.height ?? -1 })
  }
}
console.log(`tiles ${[...keys].join(', ')}: ${rings.length} buildings`)

// One shared list: every building within the radius of any block. The app works out each
// building's bearing and distance from whichever block is selected.
const round = (n: number) => Math.round(n * 1e6) / 1e6
const out = rings
  .filter(r => BLOCKS.some(b => buildingFromRing(r.ring, b.lat, b.lon).distanceM <= RADIUS_M))
  .map(r => ({ ring: r.ring.map(([lon, lat]) => [round(lon), round(lat)] as [number, number]), ...(r.height > 0 ? { heightM: r.height } : {}) }))
console.log(out.length, 'buildings within', RADIUS_M, 'm of a block')
writeFileSync(new URL('../apps/web/public/buildings.json', import.meta.url), JSON.stringify(out))
