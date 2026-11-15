<script setup lang="ts">
import type { Plan, PlanField } from '~/composables/usePlans'

/** Every field's next 48 hours on one chart: one row per field, one cell per hour. */
const props = defineProps<{ fields: PlanField[]; plans: Record<string, Plan>; selectedId: string; selectedMs: number }>()
const emit = defineEmits<{ select: [id: string, timeMs: number] }>()
const axis = computed(() => props.fields.map(f => props.plans[f.id]?.hours).find(h => h?.length) ?? [])
const dayAt = (i: number) => (i === 0 || fmtDay(axis.value[i]!.timeMs) !== fmtDay(axis.value[i - 1]!.timeMs) ? fmtDay(axis.value[i]!.timeMs) : '')
</script>

<template>
  <div class="overview" role="table" aria-label="The next 48 hours at every field">
    <div class="orow head" role="row">
      <span class="oname" />
      <span class="ocells"><span v-for="(h, i) in axis" :key="h.timeMs" class="olabel">{{ dayAt(i) || (i % 6 === 0 ? fmtHour(h.timeMs) : '') }}</span></span>
    </div>
    <div v-for="f in fields" :key="f.id" class="orow" :class="{ on: f.id === selectedId }" role="row">
      <button class="oname" @click="emit('select', f.id, selectedMs)">{{ f.name }}</button>
      <span class="ocells">
        <button
          v-for="h in plans[f.id]?.hours ?? []" :key="h.timeMs" class="ocell" :class="[h.status, { picked: f.id === selectedId && h.timeMs === selectedMs }]"
          :style="{ opacity: h.status === 'STOP' ? 0.55 : 0.4 + 0.6 * h.confidence }"
          :title="`${f.name}, ${fmtDay(h.timeMs)} ${fmtHour(h.timeMs)}: ${h.status}, confidence ${Math.round(h.confidence * 100)}%${h.reasons[0] ? '. ' + h.reasons[0] : ''}`"
          :aria-label="`${f.name}, ${fmtDay(h.timeMs)} ${fmtHour(h.timeMs)}: ${h.status}`"
          @click="emit('select', f.id, h.timeMs)"
        />
        <span v-if="!plans[f.id]" class="muted">Loading…</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.overview { display: grid; gap: 4px; }
.orow { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 10px; align-items: center; }
.oname { font: 600 14px var(--text); color: var(--muted); background: none; border: 0; padding: 0; text-align: left; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.orow.on .oname { color: var(--ink); }
.ocells { display: flex; gap: 2px; min-width: 0; }
.ocell { flex: 1; min-width: 0; height: 22px; padding: 0; border: 0; border-radius: 2px; background: var(--stop); cursor: pointer; }
.ocell.GO { background: var(--go); }
.ocell.CAUTION { background: var(--caution); }
.ocell.picked { outline: 2px solid var(--ink); outline-offset: 1px; opacity: 1 !important; }
.ocell:hover { outline: 2px solid var(--muted); }
.olabel { flex: 1; min-width: 0; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: visible; }
.head .ocells { height: 16px; }
@media (max-width: 700px) { .orow { grid-template-columns: 110px minmax(0, 1fr); } }
</style>
