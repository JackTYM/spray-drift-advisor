<script setup lang="ts">
import type { Skill } from '@drift/engine'

const props = defineProps<{ skill: Skill & { nearestTempF?: number; nearestWindMph?: number }; stations: number }>()

interface Bar { label: string; value: number; mine?: boolean }
function group(nearest: number | undefined, model: number, fused: number): Bar[] {
  const bars: Bar[] = []
  if (typeof nearest === 'number') bars.push({ label: 'Nearest station alone', value: nearest })
  bars.push({ label: 'Forecast model alone', value: model }, { label: 'Stillair estimate', value: fused, mine: true })
  return bars
}
const temp = computed(() => group(props.skill.nearestTempF, props.skill.modelTempF, props.skill.fusedTempF))
const wind = computed(() => group(props.skill.nearestWindMph, props.skill.modelWindMph, props.skill.fusedWindMph))
const pct = (bars: Bar[], v: number) => { const max = Math.max(...bars.map(b => b.value), 0.1); return `${Math.round((v / max) * 100)}%` }

const sentence = computed(() => {
  const n = props.skill.nearestTempF
  const f = props.skill.fusedTempF
  if (typeof n !== 'number') return ''
  if (f < n) return `Right now the estimate is ${Math.round(((n - f) / Math.max(n, 0.1)) * 100)}% closer on temperature than using the nearest station.`
  return `Right now the estimate is not better on temperature than the nearest station. It is off by ${(f - n).toFixed(1)} °F more.`
})
</script>

<template>
  <section class="validation">
    <h3>How much better than one weather station</h3>
    <div v-for="g in [{ title: 'Temperature error (°F)', bars: temp, unit: '°F' }, { title: 'Wind error (mph)', bars: wind, unit: 'mph' }]" :key="g.title" class="group">
      <p class="muted gtitle">{{ g.title }}</p>
      <div v-for="b in g.bars" :key="b.label" class="bar">
        <span class="name">{{ b.label }}</span>
        <span class="track"><span class="fill" :class="{ mine: b.mine }" :style="{ width: pct(g.bars, b.value) }" /><span class="val">{{ b.value.toFixed(1) }} {{ g.unit }}</span></span>
      </div>
    </div>
    <p v-if="sentence"><strong>{{ sentence }}</strong></p>
    <p class="muted">Measured just now by hiding each of {{ stations }} stations in turn and estimating it from the others. It changes hour to hour.</p>
  </section>
</template>

<style scoped>
.group { margin: 10px 0; }
.gtitle { margin: 0 0 4px; }
.bar { display: grid; grid-template-columns: 9.5rem 1fr; gap: 8px; align-items: center; margin: 3px 0; font-size: 0.9rem; }
.track { display: flex; align-items: center; gap: 6px; min-width: 0; }
.fill { display: inline-block; height: 14px; min-width: 2px; border-radius: 3px; background: var(--muted); }
.fill.mine { background: var(--go); }
.val { white-space: nowrap; }
@media (max-width: 480px) { .bar { grid-template-columns: 1fr; gap: 2px; } }
</style>
