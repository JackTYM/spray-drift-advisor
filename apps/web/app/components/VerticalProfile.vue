<script setup lang="ts">
import { explain, inversionTopFt, profileCurves, type Reading } from '@drift/engine'

const props = defineProps<{ reading: Reading | null }>()
const W = 560, H = 360, TOP = 16, BOTTOM = 312, MAXFT = 100, CANOPY_FT = 18
const TX0 = 52, TX1 = 300, WX0 = 330, WX1 = 548

const model = computed(() => {
  if (!props.reading) return null
  const e = explain(props.reading)
  const curve = profileCurves(props.reading, MAXFT)
  const temps = curve.map(p => p.tempF)
  const tMin = Math.floor(Math.min(...temps) - 1), tMax = Math.ceil(Math.max(...temps) + 1)
  const wMax = Math.max(12, Math.ceil(Math.max(...curve.map(p => p.windMph)) + 1))
  const y = (ft: number) => BOTTOM - (ft / MAXFT) * (BOTTOM - TOP)
  const tx = (f: number) => TX0 + ((f - tMin) / (tMax - tMin)) * (TX1 - TX0)
  const wx = (mph: number) => WX0 + (mph / wMax) * (WX1 - WX0)
  return {
    e, y, tx, wx, tMin, tMax, wMax,
    top: inversionTopFt(props.reading, MAXFT),
    tempLine: curve.map(p => `${tx(p.tempF).toFixed(1)},${y(p.heightFt).toFixed(1)}`).join(' '),
    windLine: curve.map(p => `${wx(p.windMph).toFixed(1)},${y(p.heightFt).toFixed(1)}`).join(' '),
  }
})
</script>

<template>
  <div v-if="!model" class="muted">Waiting for a reading.</div>
  <svg v-else :viewBox="`0 0 ${W} ${H}`" width="100%" role="img"
    :aria-label="`Vertical profile. Temperature ${model.e.lo.tempF} degrees at ${model.e.lo.heightFt} feet and ${model.e.hi.tempF} degrees at ${model.e.hi.heightFt} feet. Wind ${model.e.lo.windMph} and ${model.e.hi.windMph} miles per hour.`">
    <rect v-if="model.top" :x="TX0" :y="model.y(model.top)" :width="WX1 - TX0" :height="model.y(0) - model.y(model.top)" fill="#f2994a" opacity="0.13" />
    <rect :x="TX0" :y="model.y(CANOPY_FT)" :width="WX1 - TX0" :height="model.y(0) - model.y(CANOPY_FT)" fill="#2fbf71" opacity="0.14" />
    <g font-size="13" fill="#93a5bb">
      <template v-for="ft in [0, 20, 40, 60, 80, 100]" :key="ft">
        <line :x1="TX0" :x2="WX1" :y1="model.y(ft)" :y2="model.y(ft)" stroke="#2b3f5c" />
        <text x="44" :y="model.y(ft) + 4" text-anchor="end">{{ ft }} ft</text>
      </template>
      <text :x="TX0 + 6" :y="model.y(CANOPY_FT) + 15">tree canopy</text>
      <text v-if="model.top" :x="TX0 + 6" :y="model.y(model.top) + 15" fill="#f2994a">inversion layer, estimated to {{ model.top }} ft</text>
      <text :x="TX0" :y="H - 8">{{ model.tMin }}°F</text>
      <text :x="TX1" :y="H - 8" text-anchor="end">{{ model.tMax }}°F</text>
      <text :x="WX0" :y="H - 8">0 mph</text>
      <text :x="WX1" :y="H - 8" text-anchor="end">{{ model.wMax }} mph</text>
      <text :x="(TX0 + TX1) / 2" :y="H - 8" text-anchor="middle" fill="#e9eff6">Temperature</text>
      <text :x="(WX0 + WX1) / 2" :y="H - 8" text-anchor="middle" fill="#e9eff6">Wind speed</text>
    </g>
    <line :x1="(TX1 + WX0) / 2" :x2="(TX1 + WX0) / 2" :y1="TOP" :y2="BOTTOM" stroke="#2b3f5c" stroke-width="2" />
    <g stroke="#93a5bb" stroke-dasharray="4 4">
      <line :x1="model.wx(3)" :x2="model.wx(3)" :y1="TOP" :y2="BOTTOM" />
      <line :x1="model.wx(10)" :x2="model.wx(10)" :y1="TOP" :y2="BOTTOM" />
    </g>
    <text :x="model.wx(3) + 4" :y="TOP + 12" font-size="12" fill="#93a5bb">3</text>
    <text :x="model.wx(10) + 4" :y="TOP + 12" font-size="12" fill="#93a5bb">10 mph limits</text>
    <polyline :points="model.tempLine" fill="none" :stroke="model.e.deltaF > 0 ? '#f2994a' : '#6cb8f0'" stroke-width="3" />
    <polyline :points="model.windLine" fill="none" stroke="#e9eff6" stroke-width="3" />
    <g v-for="l in [model.e.lo, model.e.hi]" :key="l.heightFt" font-size="15" font-weight="600" fill="#e9eff6">
      <circle :cx="model.tx(l.tempF)" :cy="model.y(l.heightFt)" r="6" fill="#0d1826" stroke="#e9eff6" stroke-width="2.5" />
      <text :x="model.tx(l.tempF) + 11" :y="model.y(l.heightFt) + 5">{{ l.tempF.toFixed(1) }}°F</text>
      <circle :cx="model.wx(l.windMph)" :cy="model.y(l.heightFt)" r="6" fill="#0d1826" stroke="#e9eff6" stroke-width="2.5" />
      <text :x="model.wx(l.windMph) + 11" :y="model.y(l.heightFt) + 5">{{ l.windMph.toFixed(1) }}</text>
    </g>
  </svg>
  <p class="muted">Circles are the two sensors. The curves between and above them are fitted estimates, not measurements.</p>
</template>
