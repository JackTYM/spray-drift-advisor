<script setup lang="ts">
import type { SprayWindow } from '@drift/engine'
import type { Plan, PlanField } from '~/composables/usePlans'

/** Every field's next 48 hours, one chart per field on a shared time axis. */
const props = defineProps<{ fields: PlanField[]; plans: Record<string, Plan>; windows: Record<string, SprayWindow[]>; selectedId: string; selectedMs: number; nowMs: number }>()
const emit = defineEmits<{ select: [id: string, timeMs: number] }>()
</script>

<template>
  <div class="overview">
    <div v-for="(f, i) in fields" :key="f.id" class="orow" :class="{ on: f.id === selectedId }">
      <button class="oname" @click="emit('select', f.id, selectedMs)">{{ f.name }}</button>
      <ConfidenceChart
        v-if="plans[f.id]" :hours="plans[f.id]!.hours" :windows="windows[f.id] ?? []" :selected="f.id === selectedId ? selectedMs : 0" :now-ms="nowMs"
        :height="46" :labels="i === fields.length - 1" @select="emit('select', f.id, $event)"
      />
      <span v-else class="muted">Loading…</span>
    </div>
  </div>
</template>

<style scoped>
.overview { display: grid; gap: 8px; }
.orow { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 12px; align-items: start; }
.oname { font: 600 14px var(--text); color: var(--muted); background: none; border: 0; padding: 14px 0 0; text-align: left; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.orow.on .oname { color: var(--ink); }
@media (max-width: 700px) { .orow { grid-template-columns: 100px minmax(0, 1fr); } }
</style>
