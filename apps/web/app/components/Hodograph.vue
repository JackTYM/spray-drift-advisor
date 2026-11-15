<script setup lang="ts">
import { explain, type Reading } from '@drift/engine'

const props = defineProps<{ reading: Reading | null }>()
const S = 300, C = S / 2
const model = computed(() => {
  if (!props.reading) return null
  const e = explain(props.reading)
  const max = Math.max(10, Math.ceil(Math.max(e.lo.windMph, e.hi.windMph) / 5) * 5)
  const k = (C - 26) / max
  const pt = (u: [number, number]) => ({ x: C + u[0] * k, y: C - u[1] * k })
  return { e, max, k, lo: pt(e.uLo), hi: pt(e.uHi) }
})
</script>

<template>
  <div v-if="!model" class="muted">Waiting for a reading.</div>
  <div v-else class="hodo">
    <svg :viewBox="`0 0 ${S} ${S}`" role="img"
      :aria-label="`Wind dial. ${model.e.lo.windMph} miles per hour at ${model.e.lo.heightFt} feet and ${model.e.hi.windMph} at ${model.e.hi.heightFt} feet, ${model.e.turningDeg} degrees apart. Vector difference ${model.e.shearMph} miles per hour.`">
      <g fill="none" stroke="#2b3f5c">
        <circle v-for="r in [model.max / 2, model.max]" :key="r" :cx="C" :cy="C" :r="r * model.k" />
        <line :x1="C" :x2="C" y1="8" :y2="S - 8" /><line x1="8" :x2="S - 8" :y1="C" :y2="C" />
      </g>
      <g font-size="13" fill="#93a5bb">
        <text :x="C" y="14" text-anchor="middle">N</text><text :x="S - 6" :y="C + 4" text-anchor="end">E</text>
        <text :x="C + 4" :y="C - model.max * model.k + 14">{{ model.max }} mph</text>
      </g>
      <line :x1="model.lo.x" :y1="model.lo.y" :x2="model.hi.x" :y2="model.hi.y" stroke="#ef4f3c" stroke-width="3" stroke-dasharray="6 4" />
      <line :x1="C" :y1="C" :x2="model.lo.x" :y2="model.lo.y" stroke="#6cb8f0" stroke-width="4" stroke-linecap="round" />
      <line :x1="C" :y1="C" :x2="model.hi.x" :y2="model.hi.y" stroke="#f2994a" stroke-width="4" stroke-linecap="round" />
      <circle :cx="model.lo.x" :cy="model.lo.y" r="6" fill="#6cb8f0" /><circle :cx="model.hi.x" :cy="model.hi.y" r="6" fill="#f2994a" />
    </svg>
    <div>
      <div><span class="swatch" style="background:#6cb8f0"></span>{{ model.e.lo.heightFt }} ft: {{ model.e.lo.windMph }} mph from the {{ compass(model.e.lo.windDirDeg) }}</div>
      <div><span class="swatch" style="background:#f2994a"></span>{{ model.e.hi.heightFt }} ft: {{ model.e.hi.windMph }} mph from the {{ compass(model.e.hi.windDirDeg) }}</div>
      <div><span class="swatch" style="background:#ef4f3c"></span>Difference: {{ model.e.shearMph }} mph</div>
      <div class="figure" style="margin-top:10px">{{ model.e.turningDeg }}° apart</div>
      <p class="muted">Each arrow shows where the air at that height is going. The dashed line is the difference between them. A speed-only check misses a change in direction; this catches both.</p>
    </div>
  </div>
</template>
