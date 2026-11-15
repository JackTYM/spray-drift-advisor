<script setup lang="ts">
import type { PlanHour, SprayWindow } from '@drift/engine'

/** The hours ahead for one field: colour is the rule outcome, bar height is the confidence that every limit is met. */
const props = defineProps<{ hours: PlanHour[]; windows: SprayWindow[]; selected: number }>()
const emit = defineEmits<{ select: [timeMs: number] }>()
const inWindow = (h: PlanHour) => props.windows.some(w => h.timeMs + 3_600_000 > w.startMs && h.timeMs < w.endMs)
/** A day label where the date changes. */
const dayAt = (i: number) => (i === 0 || fmtDay(props.hours[i]!.timeMs) !== fmtDay(props.hours[i - 1]!.timeMs) ? fmtDay(props.hours[i]!.timeMs) : '')
</script>

<template>
  <div class="strip" role="listbox" aria-label="Hours ahead. Choose an hour to preview it.">
    <button
      v-for="(h, i) in hours" :key="h.timeMs" role="option" :aria-selected="h.timeMs === selected"
      :class="[h.status, { on: h.timeMs === selected, win: inWindow(h) }]"
      :aria-label="`${fmtDay(h.timeMs)} ${fmtHour(h.timeMs)}: ${h.status}, confidence ${Math.round(h.confidence * 100)} percent`"
      @click="emit('select', h.timeMs)"
    >
      <span class="day">{{ dayAt(i) }}</span>
      <span class="col"><span class="bar" :style="{ height: `${Math.max(h.confidence * 100, 6)}%` }" /></span>
      <span class="hr">{{ i % 3 === 0 ? fmtHour(h.timeMs) : '' }}</span>
    </button>
  </div>
  <p class="muted striplegend">
    <span class="swatch" style="background:var(--go)" />Sprayable
    <span class="swatch" style="background:var(--caution);margin-left:14px" />Marginal
    <span class="swatch" style="background:var(--stop);margin-left:14px" />Not sprayable.
    Bar height is confidence. Outlined hours form a window long enough for the job. Click an hour to preview it.
  </p>
</template>
