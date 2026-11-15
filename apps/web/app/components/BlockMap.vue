<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { BLOCKS, offsetPoint, type BlockSnapshot, type Surroundings } from '@drift/engine'

const props = defineProps<{ blocks: BlockSnapshot[]; selected: string; surroundings: Surroundings | null }>()
const emit = defineEmits<{ select: [id: string] }>()
const el = ref<HTMLElement | null>(null)
const color = { GO: '#2fbf71', CAUTION: '#f0b429', STOP: '#ef4f3c' } as const
let map: L.Map | undefined
let layer: L.LayerGroup | undefined

const bufferM = useBufferM()
const facts = computed(() => downwindFacts(props.blocks.find(b => b.id === props.selected) ?? null, props.surroundings, bufferM.value))

function draw() {
  if (!map || !layer) return
  layer.clearLayers()
  const sel = BLOCKS.find(b => b.id === props.selected)
  const f = facts.value

  if (sel && props.surroundings) {
    L.circle([sel.lat, sel.lon], { radius: bufferM.value, color: '#e9eff6', weight: 1.5, dashArray: '6 6', fill: false }).addTo(layer)
    const downwind = new Set((f?.addresses ?? []).map(a => `${a.lat},${a.lon}`))
    for (const a of props.surroundings.addresses) {
      const hit = downwind.has(`${a.lat},${a.lon}`)
      L.circleMarker([a.lat, a.lon], { radius: hit ? 6 : 3.5, color: '#0d1826', weight: 1, fillColor: hit ? '#f2994a' : '#cfd9e6', fillOpacity: 1 })
        .bindTooltip(`${a.label}, ${a.distanceM} m`).addTo(layer)
    }
    for (const c of props.surroundings.crops) {
      if (!c.category) continue
      L.marker([c.lat, c.lon], { interactive: false, icon: L.divIcon({ className: 'crop-label', html: c.category, iconSize: [120, 18] }) }).addTo(layer)
    }
    if (f && !f.calm) {
      const tip = offsetPoint(sel.lat, sel.lon, f.towardDeg, bufferM.value + 60)
      const left = offsetPoint(tip.lat, tip.lon, f.towardDeg + 150, 70)
      const right = offsetPoint(tip.lat, tip.lon, f.towardDeg - 150, 70)
      L.polyline([[sel.lat, sel.lon], [tip.lat, tip.lon]], { color: '#f2994a', weight: 4 }).addTo(layer)
      L.polygon([[tip.lat, tip.lon], [left.lat, left.lon], [right.lat, right.lon]], { color: '#f2994a', fillColor: '#f2994a', fillOpacity: 1, weight: 1 }).addTo(layer)
    }
  }

  for (const b of props.blocks) {
    const m = BLOCKS.find(x => x.id === b.id)
    if (!m) continue
    const status = b.evaluation?.status
    L.polygon(m.outline.map(([lon, lat]) => [lat, lon] as [number, number]), { color: status ? color[status] : '#93a5bb', weight: 3, fillOpacity: 0.12 }).addTo(layer)
    L.circleMarker([m.lat, m.lon], { radius: b.id === props.selected ? 13 : 10, color: '#fff', weight: b.id === props.selected ? 3 : 1.5, fillColor: status ? color[status] : '#93a5bb', fillOpacity: 1 })
      .bindTooltip(`${b.name}: ${status ?? 'waiting'}`, { permanent: true, direction: 'top', offset: [0, -10], className: 'block-label' })
      .on('click', () => emit('select', b.id)).addTo(layer)
  }
}

onMounted(() => {
  const sel = BLOCKS.find(b => b.id === props.selected) ?? BLOCKS[0]!
  map = L.map(el.value!, { zoomControl: true, attributionControl: true }).setView([sel.lat, sel.lon], 15)
  L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 16, maxZoom: 18, attribution: 'Imagery: USGS The National Map. Addresses: Pima County. Crops: USDA NASS Cropland Data Layer.',
  }).addTo(map)
  map.attributionControl.setPrefix(false)
  layer = L.layerGroup().addTo(map)
  draw()
})
onBeforeUnmount(() => map?.remove())
watch(() => [props.blocks, props.surroundings], draw, { deep: true })
watch(() => props.selected, id => {
  const b = BLOCKS.find(x => x.id === id)
  if (b) map?.panTo([b.lat, b.lon])
  draw()
})
</script>

<template>
  <div>
    <div ref="el" class="blockmap" role="application" aria-label="Satellite map of the blocks, nearby addresses, neighbouring crops and the downwind direction" />
    <p v-if="facts && surroundings" class="mapfact">
      <template v-if="facts.calm">Wind at the lowest level is near calm, so drift has no clear direction.</template>
      <template v-else>
        Wind at the lowest level carries spray toward the <strong>{{ facts.dir }}</strong>.
        <strong>{{ facts.addresses.length }}</strong> {{ facts.addresses.length === 1 ? 'address lies' : 'addresses lie' }} within {{ bufferM }} m that way<template v-if="facts.crop">; the land there is mapped as <strong>{{ facts.crop.toLowerCase() }}</strong></template>.
      </template>
      <span v-if="surroundings.lowGround"> This block sits below its surroundings, where cold air pools.</span>
    </p>
    <p class="muted">Dashed ring: {{ bufferM }} m example buffer from the block centre. Use the distance on the product label.</p>
  </div>
</template>
