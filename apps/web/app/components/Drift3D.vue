<script setup lang="ts">
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer } from '@deck.gl/layers'
import {
  ALOFT_M, BLOCKS, CANOPY_M, LOW_M, SETTLE, batchDrift, bounds, downwindOf, driftEnv, ends, gaussian, localOutline, mulberry32, pointInPolygon,
  buildingFromRing, rowSpans, stepDroplet, toLngLat,
  type BlockSnapshot, type Building, type DriftEnv, type Droplet, type Job, type Surroundings,
} from '@drift/engine'

/** `models` gives the fields to draw (centre and boundary); without it the ranch's own blocks are drawn. */
const props = defineProps<{ blocks: BlockSnapshot[]; selected: string; surroundings: Surroundings | null; droplet: Job['droplet']; models?: { id: string; lat: number; lon: number; outline: [number, number][] }[] }>()
const models = computed(() => (props.models?.length ? props.models : BLOCKS))
/** Footprints are only shipped for the Sahuarita area: farther than this from the field, none are drawn. */
const FOOTPRINT_RANGE_M = 4000

/** Heights are drawn five times taller than true so a 30 ft tower is visible at map scale. */
const EXAG = 5
const ROW_SPACING_M = 12
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
let sprayerRow = 0, sprayerX = 0, sprayerDir = 1
/** Real building outlines from OpenStreetMap, fetched once and shipped with the app. */
const footprints = ref<{ ring: [number, number][]; heightM?: number }[]>([])
/** Every loaded building, with its bearing and distance from the selected block. */
const buildings = computed<Building[]>(() => footprints.value.map(f => buildingFromRing(f.ring, model.value.lat, model.value.lon, f.heightM)).filter(b => b.distanceM <= FOOTPRINT_RANGE_M))
const rand = mulberry32(7)
const g = gaussian(rand)

const model = computed(() => models.value.find(b => b.id === props.selected) ?? models.value[0] ?? BLOCKS[0]!)
const snap = computed(() => props.blocks.find(b => b.id === props.selected) ?? null)
/** The selected block's real field boundary and tree rows, in metres from its centre. */
const field = computed(() => localOutline(model.value))
/** Rows in the order the sprayer drives them: starting on the upwind side, so drift crosses the block. */
const spans = computed(() => {
  const rows = rowSpans(field.value, ROW_SPACING_M)
  const towardNorth = facts.value && !facts.value.calm ? Math.cos((facts.value.towardDeg * Math.PI) / 180) > 0 : false
  return towardNorth ? rows : [...rows].reverse()
})
const bufferM = useBufferM()
const facts = computed(() => downwindFacts(snap.value, props.surroundings, bufferM.value))

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
  const res = batchDrift(r, props.droplet, receptors.value, { field: field.value })
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
  for (const b of models.value) {
    const status = props.blocks.find(x => x.id === b.id)?.evaluation?.status
    // Rows run east-west, as they do in the imagery, and are clipped to the field boundary.
    for (const r of rowSpans(localOutline(b), ROW_SPACING_M)) rows.push(feature(rect(b.lat, b.lon, r.x0, r.y - 2.5, r.x1, r.y + 2.5), {}))
    outlines.push(feature([[...b.outline, b.outline[0]!]], { color: status ? statusColor[status] : '#93a5bb' }))
  }
  setData('rows', collection(rows))
  setData('outlines', collection(outlines))

  const m = model.value
  const r = snap.value?.reading
  const hiFt = r ? ends(r).hi.heightFt : 30
  const east = bounds(field.value).maxX
  setData('tower', collection([feature(rect(m.lat, m.lon, east + 8, -2, east + 12, 2), { h: hiFt * 0.3048 * EXAG })]))

  // Real outlines where OpenStreetMap has them; otherwise a small box at each county address point.
  const outlines3d = buildings.value
  const mine = buildings.value
  const wind = facts.value && !facts.value.calm ? facts.value.windFromDeg : null
  const hit = new Set(wind === null ? [] : downwindOf(mine, wind, bufferM.value))
  if (outlines3d.length) {
    setData('addresses', collection(outlines3d.map(o => feature([o.ring], { color: hit.has(o) ? '#f2994a' : '#dfe6ee' }))))
  } else {
    const downwind = new Set((facts.value?.addresses ?? []).map(a => `${a.lat},${a.lon}`))
    setData('addresses', collection((props.surroundings?.addresses ?? []).map(a => {
      const dLat = 7 / M_PER_DEG, dLon = 7 / (M_PER_DEG * Math.cos((a.lat * Math.PI) / 180))
      return feature([[[a.lon - dLon, a.lat - dLat], [a.lon + dLon, a.lat - dLat], [a.lon + dLon, a.lat + dLat], [a.lon - dLon, a.lat + dLat], [a.lon - dLon, a.lat - dLat]]],
        { color: downwind.has(`${a.lat},${a.lon}`) ? '#f2994a' : '#dfe6ee' })
    })))
  }

  // Arrow on the ground beyond the downwind edge: where the wind at the lowest level carries spray.
  const arrow = []
  if (facts.value && !facts.value.calm) {
    const t = (facts.value.towardDeg * Math.PI) / 180
    const d = { x: Math.sin(t), y: Math.cos(t) }, n = { x: d.y, y: -d.x }
    const bb = bounds(field.value)
    const start = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) / 2 + 40
    const at = (along: number, across: number) => toLngLat(m.lat, m.lon, d.x * (start + along) + n.x * across, d.y * (start + along) + n.y * across)
    const ring = [at(0, -9), at(150, -9), at(150, -30), at(215, 0), at(150, 30), at(150, 9), at(0, 9), at(0, -9)]
    arrow.push(feature([ring], {}))
  }
  setData('wind', collection(arrow))

  const lid = env?.lidM ?? null
  setData('lid', collection(lid === null ? [] : [feature(rect(m.lat, m.lon, -750, -750, 750, 750), { base: lid * EXAG, top: lid * EXAG + 3 })]))
}

function tick() {
  frame = requestAnimationFrame(tick)
  if (!overlay || !env) return
  const m = model.value
  const dt = 0.9

  // The sprayer drives each alley in turn, back and forth across the field, blowing droplets into the canopy.
  const rows = spans.value
  if (rows.length) {
    const row = rows[sprayerRow % rows.length]!
    sprayerX += sprayerDir * Math.max((row.x1 - row.x0) / 90, 2.4)
    if (sprayerX > row.x1 - 6 || sprayerX < row.x0 + 6) {
      sprayerRow = (sprayerRow + 1) % rows.length
      sprayerDir *= -1
      const next = rows[sprayerRow]!
      sprayerX = sprayerDir > 0 ? next.x0 + 6 : next.x1 - 6
    }
    const alleyY = rows[sprayerRow]!.y + ROW_SPACING_M / 2
    for (let i = 0; i < 5 && drops.length < 2600; i++) {
      drops.push({ x: sprayerX + (rand() - 0.5) * 6, y: alleyY + (rand() - 0.5) * 8, z: 1 + rand() * (CANOPY_M - 1), vs: SETTLE[props.droplet] * (0.6 + rand() * 0.8), age: 0, leftLow: false, hit: -1 })
      stats.emitted++
    }
  }
  drops = drops.filter(p => {
    const alive = stepDroplet(p, env!, dt, g, field.value)
    const far = Math.abs(p.x) > 900 || Math.abs(p.y) > 900 || p.age > 900
    if (alive && !far) return true
    const inside = pointInPolygon(p.x, p.y, field.value)
    if (p.z >= ALOFT_M) stats.aloft++
    else if (p.leftLow || !inside) stats.offLow++
    else stats.landed++
    if (p.z <= 0) { deposits.push({ x: p.x, y: p.y, off: !inside }); if (deposits.length > 2200) deposits.shift() }
    return false
  })

  overlay.setProps({
    layers: [
      new ScatterplotLayer({
        // Where droplets came down. Inside the block they are drawn on top of the trees so they are not hidden; outside, on the ground.
        id: 'deposits', data: deposits, radiusUnits: 'meters', stroked: false,
        getRadius: (d: { off: boolean }) => (d.off ? 7 : 4), radiusMinPixels: 2.5,
        getPosition: (d: { x: number; y: number; off: boolean }) => [...toLngLat(m.lat, m.lon, d.x, d.y), d.off ? 0.6 : CANOPY_M * EXAG + 1],
        getFillColor: (d: { off: boolean }) => (d.off ? [214, 72, 232, 235] : [176, 255, 96, 210]),
      }),
      new ScatterplotLayer({
        id: 'drops', data: drops, radiusUnits: 'pixels', getRadius: props.droplet === 'fine' ? 1.6 : props.droplet === 'medium' ? 2.1 : 2.7, billboard: true, stroked: false,
        getPosition: (p: Droplet) => [...toLngLat(m.lat, m.lon, p.x, p.y), p.z * EXAG],
        getFillColor: (p: Droplet) => (p.z < LOW_M ? [255, 120, 100, 235] : p.z < ALOFT_M ? [255, 214, 120, 225] : [150, 205, 255, 215]),
      }),
    ],
  })
}

function view(kind: 'overview' | 'top') {
  const m = model.value
  const toward = facts.value && !facts.value.calm ? facts.value.towardDeg : 90
  const cam = kind === 'top' ? { pitch: 0, bearing: 0, zoom: 15.1 }
    : { pitch: 58, bearing: toward - 125, zoom: 15 }
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
  seedDeposits()
  drawStatic()
}

/**
 * Shows where spray lands straight away, instead of waiting for the animation to build it up:
 * a batch of droplets released across the whole block is run to the ground with the same physics.
 */
function seedDeposits() {
  deposits = []
  if (!env) return
  const f = field.value
  const b = bounds(f)
  for (let i = 0; i < 900; i++) {
    let x = 0, y = 0
    for (let tries = 0; tries < 20; tries++) {
      x = b.minX + rand() * (b.maxX - b.minX); y = b.minY + rand() * (b.maxY - b.minY)
      if (pointInPolygon(x, y, f)) break
    }
    const p: Droplet = { x, y, z: 1 + rand() * (CANOPY_M - 1), vs: SETTLE[props.droplet] * (0.6 + rand() * 0.8), age: 0, leftLow: false, hit: -1 }
    let alive = true
    for (let s = 0; s < 500 && alive; s++) alive = stepDroplet(p, env, 2, g, f)
    if (p.z <= 0 && Math.abs(p.x) < 900 && Math.abs(p.y) < 900) deposits.push({ x: p.x, y: p.y, off: !pointInPolygon(p.x, p.y, f) })
  }
}

onMounted(() => {
  const m = model.value
  $fetch<{ ring: [number, number][]; heightM?: number }[]>('/buildings.json').then(b => { footprints.value = b; drawStatic() }).catch(() => { /* boxes are used instead */ })
  try {
    maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs')
    map = new maplibregl.Map({
      container: el.value!, center: [m.lon, m.lat], zoom: 15, pitch: 58, bearing: -35, maxPitch: 85, attributionControl: { compact: true },
      style: {
        version: 8,
        sources: { sat: { type: 'raster', tileSize: 256, maxzoom: 16, tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'], attribution: 'Imagery: USGS The National Map. Buildings: Microsoft Building Footprints. Addresses: Pima County.' } },
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
    for (const id of ['rows', 'outlines', 'tower', 'addresses', 'lid', 'wind']) map!.addSource(id, { type: 'geojson', data: empty as never })
    map!.addLayer({ id: 'wind', type: 'fill', source: 'wind', paint: { 'fill-color': '#f2994a', 'fill-opacity': 0.95, 'fill-outline-color': '#0d1826' } })
    map!.addLayer({ id: 'outlines', type: 'line', source: 'outlines', paint: { 'line-color': ['get', 'color'], 'line-width': 4 } })
    map!.addLayer({ id: 'rows', type: 'fill-extrusion', source: 'rows', paint: { 'fill-extrusion-color': '#2c6a45', 'fill-extrusion-height': CANOPY_M * EXAG, 'fill-extrusion-opacity': 0.92 } })
    map!.addLayer({ id: 'addresses', type: 'fill-extrusion', source: 'addresses', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': 9, 'fill-extrusion-opacity': 0.95 } })
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
  sprayerRow = 0; sprayerX = spans.value[0]?.x0 ?? 0; sprayerDir = 1
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
        <button @click="view('top')">From above</button>
        <span class="muted">Drag to orbit. Trees, tower, air and droplets are drawn {{ EXAG }} times taller than true; buildings about twice.</span>
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
        <template v-if="facts && !facts.calm">The amber arrow shows where the wind at the lowest level carries spray: toward the {{ facts.dir }}. The sprayer starts on the upwind side. </template>
        Droplet colour shows height: <span style="color:#ff7864">below 15 ft</span>, <span style="color:#ffd678">15 to 40 ft</span>, <span style="color:#96cdff">above 40 ft</span>.
Where spray lands: <span style="color:#b0ff60">bright green dots</span> landed on the block, <span style="color:#e06cf0">purple dots</span> landed outside it. <span v-if="hasLid">The amber sheet is the estimated top of the inversion.</span>
        This is a model for comparing conditions with each other, not a prediction of how much spray lands where.
      </p>
    </template>
  </div>
</template>
