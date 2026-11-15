<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { BLOCKS, type Status } from '@drift/engine'
import type { Plan, PlanField } from '~/composables/usePlans'

/** Every station that informs the selected field's estimate, the fields being planned, and a way to add one. */
const props = defineProps<{ fields: PlanField[]; plan: Plan | null; selected: string; statuses: Record<string, Status | undefined>; adding: boolean }>()
const emit = defineEmits<{ select: [id: string]; add: [lat: number, lon: number] }>()
const el = ref<HTMLElement | null>(null)
const color = { GO: '#2fbf71', CAUTION: '#f0b429', STOP: '#ef4f3c' } as const
let map: L.Map | undefined
let layer: L.LayerGroup | undefined
let fitted = ''

function draw() {
  if (!map || !layer) return
  layer.clearLayers()
  const sel = props.fields.find(f => f.id === props.selected)
  const weights = new Map((props.plan?.estimate.stations ?? []).map(s => [s.id, s]))

  for (const s of props.plan?.stations ?? []) {
    const w = weights.get(s.id)
    if (sel && w && w.weight >= 0.01) L.polyline([[sel.lat, sel.lon], [s.lat, s.lon]], { color: '#6cb8f0', weight: 1 + w.weight * 5, opacity: 0.75 }).addTo(layer)
    const diff = Math.round((s.tempF - s.modelTempF) * 10) / 10
    L.circleMarker([s.lat, s.lon], { radius: 6 + (w?.weight ?? 0) * 8, color: '#0d1826', weight: 1.5, fillColor: w && w.weight >= 0.01 ? '#6cb8f0' : '#93a5bb', fillOpacity: 1 })
      .bindTooltip(`<b>${s.name}</b> (${s.network})<br>${Math.round(s.tempF)}°F, ${Math.round(s.windMph)} mph<br>Model here: ${diff > 0 ? '+' : ''}${diff}°F off${w ? `<br>Weight ${Math.round(w.weight * 100)}%, ${w.distanceKm} km` : ''}`)
      .addTo(layer)
  }
  for (const b of BLOCKS) L.polygon(b.outline.map(([lon, lat]) => [lat, lon] as [number, number]), { color: '#e9eff6', weight: 1.5, fillOpacity: 0.08, interactive: false }).addTo(layer)
  for (const f of props.fields) {
    const status = props.statuses[f.id]
    L.circleMarker([f.lat, f.lon], { radius: f.id === props.selected ? 12 : 9, color: '#fff', weight: f.id === props.selected ? 3 : 1.5, fillColor: status ? color[status] : '#93a5bb', fillOpacity: 1 })
      .bindTooltip(f.name, { permanent: true, direction: 'top', offset: [0, -10], className: 'block-label' })
      .on('click', () => emit('select', f.id)).addTo(layer)
  }

  // Frame the field with the stations that carry weight, once per field.
  if (sel && props.plan && fitted !== sel.id) {
    fitted = sel.id
    const pts: [number, number][] = [[sel.lat, sel.lon], ...props.plan.estimate.stations.filter(s => s.weight >= 0.01).map(s => [s.lat, s.lon] as [number, number])]
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 13 })
    else map.setView([sel.lat, sel.lon], 10)
  }
}

onMounted(() => {
  const sel = props.fields.find(f => f.id === props.selected) ?? props.fields[0]!
  map = L.map(el.value!, { zoomControl: true }).setView([sel.lat, sel.lon], 10)
  L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 16, maxZoom: 18, attribution: 'Imagery: USGS The National Map. Stations: AZMet, NOAA Aviation Weather Center. Model: Open-Meteo.',
  }).addTo(map)
  map.attributionControl.setPrefix(false)
  map.on('click', e => { if (props.adding) emit('add', e.latlng.lat, e.latlng.lng) })
  layer = L.layerGroup().addTo(map)
  draw()
})
onBeforeUnmount(() => map?.remove())
watch(() => [props.fields, props.plan, props.statuses, props.selected], draw, { deep: true })
</script>

<template>
  <div>
    <div ref="el" class="blockmap" :class="{ adding }" role="application" aria-label="Map of the fields being planned and the weather stations that inform each estimate" />
    <p class="muted">Blue dots are stations used for this field; the thicker the line, the more that station counts. Grey dots are too far away or at too different an elevation to count.</p>
  </div>
</template>
