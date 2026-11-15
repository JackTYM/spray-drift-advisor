<script setup lang="ts">
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer } from '@deck.gl/layers'
import {
  ALOFT_M, BLOCKS, CANOPY_M, LOW_M, SETTLE, batchDrift, driftEnv, ends, gaussian, mulberry32, stepDroplet,
  type BlockSnapshot, type DriftEnv, type Droplet, type Job, type Surroundings,
} from '@drift/engine'

const props = defineProps<{ blocks: BlockSnapshot[]; selected: string; surroundings: Surroundings | null; droplet: Job['droplet'] }>()

/** Heights are drawn five times taller than true so a 30 ft tower is visible at map scale. */
const EXAG = 5
const HALF = 150
const M_PER_DEG = 111_320
const statusColor = { GO: '#2fbf71', CAUTION: '#f0b429', STOP: '#ef4f3c' } as const

const el = ref<HTMLElement | null>(null)
const failed = ref(false)
const hasLid = ref(false)
const stats = reactive({ emitted: 0, landed: 0, offLow: 0, aloft: 0 })
let map: maplibregl.Map | undefined
let overlay: MapboxOverlay | undefined
let frame = 0
let ready = false
let env: DriftEnv | null = null
let drops: Droplet[] = []
let deposits: { x: number; y: number; off: boolean }[] = []
let sprayerY = -HALF + 20, sprayerDir = 1
const rand = mulberry32(7)
const g = gaussian(rand)

const model = computed(() => BLOCKS.find(b => b.id === props.selected) ?? BLOCKS[0]!)
const snap = computed(() => props.blocks.find(b => b.id === props.selected) ?? null)
const facts = computed(() => downwindFacts(snap.value, props.surroundings))

const toLngLat = (lat0: number, lon0: number, x: number, y: number): [number, number] =>
  [lon0 + x / (M_PER_DEG * Math.cos((lat0 * Math.PI) / 180)), lat0 + y / M_PER_DEG]
const rect = (lat0: number, lon0: number, x0: number, y0: number, x1: number, y1: number) =>
  [[toLngLat(lat0, lon0, x0, y0), toLngLat(lat0, lon0, x1, y0), toLngLat(lat0, lon0, x1, y1), toLngLat(lat0, lon0, x0, y1), toLngLat(lat0, lon0, x0, y0)]]
const feature = (coordinates: number[][][], properties: Record<string, unknown>) => ({ type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates }, properties })
const collection = (features: ReturnType<typeof feature>[]) => ({ type: 'FeatureCollection' as const, features })

/** Addresses near the block, in metres east and north of its centre. */
const receptors = computed(() => (props.surroundings?.addresses ?? []).filter(a => a.distanceM <= 600).slice(0, 12).map(a => {
  const b = (a.bearingDeg * Math.PI) / 180
  return { label: a.label, distanceM: a.distanceM, x: a.distanceM * Math.sin(b), y: a.distanceM * Math.cos(b) }
}))

/** Model comparison for the current reading: where a batch of droplets ends up. */
const batch = computed(() => {
  const r = snap.value?.reading
  if (!r) return null
  const res = batchDrift(r, props.droplet, receptors.value)
  let worst = -1
  res.perThousand.forEach((v, i) => { if (v > 0 && (worst < 0 || v > res.perThousand[worst]!)) worst = i })
  return { ...res, worst: worst < 0 ? null : { ...receptors.value[worst]!, perThousand: res.perThousand[worst]! } }
})

function setData(id: string, data: unknown) {
  (map?.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data as never)
}

function drawStatic() {
  if (!map || !ready) return
  const rows = [], outlines = []
  for (const b of BLOCKS) {
    const status = props.blocks.find(x => x.id === b.id)?.evaluation?.status
    for (let x = -HALF + 6; x < HALF; x += 12) rows.push(feature(rect(b.lat, b.lon, x - 2.5, -HALF, x + 2.5, HALF), {}))
    outlines.push(feature(rect(b.lat, b.lon, -HALF - 6, -HALF - 6, HALF + 6, HALF + 6), { color: status ? statusColor[status] : '#93a5bb' }))
  }
  setData('rows', collection(rows))
  setData('outlines', collection(outlines))

  const m = model.value
  const r = snap.value?.reading
  const hiFt = r ? ends(r).hi.heightFt : 30
  setData('tower', collection([feature(rect(m.lat, m.lon, HALF + 10, -2, HALF + 14, 2), { h: hiFt * 0.3048 * EXAG })]))

  const downwind = new Set((facts.value?.addresses ?? []).map(a => `${a.lat},${a.lon}`))
  setData('addresses', collection((props.surroundings?.addresses ?? []).map(a => {
    const dLat = 7 / M_PER_DEG, dLon = 7 / (M_PER_DEG * Math.cos((a.lat * Math.PI) / 180))
    return feature([[[a.lon - dLon, a.lat - dLat], [a.lon + dLon, a.lat - dLat], [a.lon + dLon, a.lat + dLat], [a.lon - dLon, a.lat + dLat], [a.lon - dLon, a.lat - dLat]]],
      { color: downwind.has(`${a.lat},${a.lon}`) ? '#f2994a' : '#dfe6ee' })
  })))

  const lid = env?.lidM ?? null
  setData('lid', collection(lid === null ? [] : [feature(rect(m.lat, m.lon, -520, -520, 520, 520), { base: lid * EXAG, top: lid * EXAG + 3 })]))
}

function tick() {
  frame = requestAnimationFrame(tick)
  if (!overlay || !env) return
  const m = model.value
  const dt = 0.9

  // The sprayer works up and down the rows, blowing droplets into the canopy.
  sprayerY += sprayerDir * 1.6
  if (Math.abs(sprayerY) > HALF - 15) sprayerDir *= -1
  for (let i = 0; i < 5 && drops.length < 2600; i++) {
    drops.push({ x: -HALF + 40 + (rand() - 0.5) * 12, y: sprayerY + (rand() - 0.5) * 6, z: 1 + rand() * (CANOPY_M - 1), vs: SETTLE[props.droplet] * (0.6 + rand() * 0.8), age: 0, leftLow: false, hit: -1 })
    stats.emitted++
  }
  drops = drops.filter(p => {
    const alive = stepDroplet(p, env!, dt, g, HALF)
    const far = Math.abs(p.x) > 700 || Math.abs(p.y) > 700 || p.age > 900
    if (alive && !far) return true
    const inside = Math.abs(p.x) <= HALF && Math.abs(p.y) <= HALF
    if (p.z >= ALOFT_M) stats.aloft++
    else if (p.leftLow || !inside) stats.offLow++
    else stats.landed++
    if (p.z <= 0) { deposits.push({ x: p.x, y: p.y, off: !inside }); if (deposits.length > 2200) deposits.shift() }
    return false
  })

  overlay.setProps({
    layers: [
      new ScatterplotLayer({
        id: 'deposits', data: deposits, radiusUnits: 'meters', getRadius: 4, stroked: false,
        getPosition: (d: { x: number; y: number }) => [...toLngLat(m.lat, m.lon, d.x, d.y), 0.5],
        getFillColor: (d: { off: boolean }) => (d.off ? [226, 70, 215, 190] : [170, 150, 255, 90]),
      }),
      new ScatterplotLayer({
        id: 'drops', data: drops, radiusUnits: 'pixels', getRadius: props.droplet === 'fine' ? 1.6 : props.droplet === 'medium' ? 2.1 : 2.7, billboard: true, stroked: false,
        getPosition: (p: Droplet) => [...toLngLat(m.lat, m.lon, p.x, p.y), p.z * EXAG],
        getFillColor: (p: Droplet) => (p.z < LOW_M ? [255, 120, 100, 235] : p.z < ALOFT_M ? [255, 214, 120, 225] : [150, 205, 255, 215]),
      }),
    ],
  })
}

function view(kind: 'overview' | 'side' | 'top') {
  const m = model.value
  const toward = facts.value && !facts.value.calm ? facts.value.towardDeg : 90
  const cam = kind === 'top' ? { pitch: 0, bearing: 0, zoom: 15.4 }
    : kind === 'side' ? { pitch: 80, bearing: toward - 90, zoom: 15.9 }
    : { pitch: 58, bearing: toward - 125, zoom: 15.3 }
  map?.easeTo({ center: [m.lon, m.lat], duration: 900, ...cam })
}

function resetAir() {
  const r = snap.value?.reading
  env = r ? driftEnv(r) : null
  const lid = env?.lidM != null
  if (lid !== hasLid.value) {
    // The air changed regime: clear the old cloud so the counts describe the new conditions.
    drops = []; deposits = []
    Object.assign(stats, { emitted: 0, landed: 0, offLow: 0, aloft: 0 })
  }
  hasLid.value = lid
  drawStatic()
}

onMounted(() => {
  const m = model.value
  try {
    maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs')
    map = new maplibregl.Map({
      container: el.value!, center: [m.lon, m.lat], zoom: 15.3, pitch: 58, bearing: -35, maxPitch: 85, attributionControl: { compact: true },
      style: {
        version: 8,
        sources: { sat: { type: 'raster', tileSize: 256, maxzoom: 16, tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'], attribution: 'Imagery: USGS The National Map. Addresses: Pima County.' } },
        layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
      },
    })
  } catch {
    failed.value = true
    return
  }
  map.on('error', e => { if (String(e.error?.message ?? '').includes('WebGL')) failed.value = true })
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
  map.on('load', () => {
    const empty = collection([])
    for (const id of ['rows', 'outlines', 'tower', 'addresses', 'lid']) map!.addSource(id, { type: 'geojson', data: empty as never })
    map!.addLayer({ id: 'outlines', type: 'line', source: 'outlines', paint: { 'line-color': ['get', 'color'], 'line-width': 4 } })
    map!.addLayer({ id: 'rows', type: 'fill-extrusion', source: 'rows', paint: { 'fill-extrusion-color': '#2c6a45', 'fill-extrusion-height': CANOPY_M * EXAG, 'fill-extrusion-opacity': 0.92 } })
    map!.addLayer({ id: 'addresses', type: 'fill-extrusion', source: 'addresses', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': 4.5 * EXAG, 'fill-extrusion-opacity': 0.95 } })
    map!.addLayer({ id: 'tower', type: 'fill-extrusion', source: 'tower', paint: { 'fill-extrusion-color': '#f4f7fb', 'fill-extrusion-height': ['get', 'h'] } })
    map!.addLayer({ id: 'lid', type: 'fill-extrusion', source: 'lid', paint: { 'fill-extrusion-color': '#f2994a', 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-opacity': 0.3 } })
    overlay = new MapboxOverlay({ interleaved: false, layers: [] })
    map!.addControl(overlay as unknown as maplibregl.IControl)
    ready = true
    resetAir()
    frame = requestAnimationFrame(tick)
  })
})
onBeforeUnmount(() => { cancelAnimationFrame(frame); map?.remove() })

watch(() => [snap.value?.reading, props.surroundings, props.blocks.map(b => b.evaluation?.status).join()], resetAir)
watch(() => props.selected, () => {
  drops = []; deposits = []
  Object.assign(stats, { emitted: 0, landed: 0, offLow: 0, aloft: 0 })
  resetAir()
  view('overview')
})
watch(() => props.droplet, () => { drops = [] })

const done = computed(() => Math.max(stats.landed + stats.offLow + stats.aloft, 1))
const pct = (n: number) => `${Math.round((n / done.value) * 100)}%`
</script>

<template>
  <div>
    <div v-if="failed" class="muted">This browser could not start the 3D view. Use the Map tab.</div>
    <template v-else>
      <div class="jumps" style="margin-bottom:10px">
        <button @click="view('overview')">Overview</button>
        <button @click="view('side')">Side on</button>
        <button @click="view('top')">From above</button>
        <span class="muted">Drag to orbit. Heights are drawn {{ EXAG }} times taller than true.</span>
      </div>
      <div ref="el" class="drift3d" role="application" aria-label="Three-dimensional view of the orchard on satellite imagery, with spray droplets carried by the wind" />
      <div class="stats">
        <div><span class="figure">{{ pct(stats.landed) }}</span>landed in the block</div>
        <div><span class="figure" style="color:#ff7864">{{ pct(stats.offLow) }}</span>drifted off, low</div>
        <div><span class="figure" style="color:#96cdff">{{ pct(stats.aloft) }}</span>mixed out aloft</div>
        <div v-if="batch?.worst"><span class="figure" style="color:var(--warm)">{{ batch.worst.perThousand }} / 1,000</span>reach {{ batch.worst.label }}, {{ batch.worst.distanceM }} m away</div>
        <div v-else-if="batch"><span class="figure">0 / 1,000</span>reach any address within 600 m</div>
      </div>
      <p class="muted">
        Droplet colour shows height: <span style="color:#ff7864">below 15 ft</span>, <span style="color:#ffd678">15 to 40 ft</span>, <span style="color:#96cdff">above 40 ft</span>.
        Pink dots are deposits outside the block. <span v-if="hasLid">The amber sheet is the estimated top of the inversion.</span>
        This is a model for comparing conditions with each other, not a prediction of how much spray lands where.
      </p>
    </template>
  </div>
</template>
