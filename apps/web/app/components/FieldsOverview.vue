<script setup lang="ts">
import type { SprayWindow } from '@drift/engine'
import type { Plan, PlanField } from '~/composables/usePlans'

/** Every field's next 48 hours on one chart: each hour is coloured by all the fields together. */
const props = defineProps<{ fields: PlanField[]; plans: Record<string, Plan>; windows: Record<string, SprayWindow[]>; selectedMs: number; nowMs: number }>()
const emit = defineEmits<{ select: [timeMs: number] }>()
const loaded = computed(() => props.fields.map(f => props.plans[f.id]).filter((p): p is Plan => !!p))
/** The shared time axis: the hours of the first loaded plan. */
const axis = computed(() => loaded.value[0]?.hours ?? [])
/** For each hour, the average across fields of the share that is sprayable, marginal or closed. */
const series = computed(() => axis.value.map(a => {
  const at = loaded.value.map(p => p.hours.find(h => h.timeMs === a.timeMs)).filter(h => !!h).map(h => hourShares(h!))
  const n = at.length || 1
  return { go: at.reduce((s, x) => s + x.go, 0) / n, caution: at.reduce((s, x) => s + x.caution, 0) / n, stop: at.reduce((s, x) => s + x.stop, 0) / n }
}))
const allWindows = computed(() => Object.values(props.windows).flat())
</script>

<template>
  <ConfidenceChart v-if="axis.length" :hours="axis" :series="series" :windows="allWindows" :selected="selectedMs" :now-ms="nowMs" :height="150" @select="emit('select', $event)" />
  <p v-else class="muted">Loading the plans…</p>
</template>
