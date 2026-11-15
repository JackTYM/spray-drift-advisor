<script setup lang="ts">
import type { PlanHour, SprayWindow } from '@drift/engine'
import type { Shares } from '~/utils/shares'

/**
 * The hours ahead as stacked shares: how likely each hour is to be sprayable (green), marginal (amber) or closed (red),
 * given the measured error of the estimate. The thin strip underneath is the single most likely outcome.
 * Dark bars on top are the windows the whole job fits in.
 */
/** `series` replaces the per-hour shares, for a chart that combines several fields. */
const props = withDefaults(defineProps<{ series?: Shares[]; hours: PlanHour[]; windows?: SprayWindow[]; selected?: number; nowMs?: number; height?: number; labels?: boolean }>(), { windows: () => [], selected: 0, nowMs: 0, height: 150, labels: true })
const emit = defineEmits<{ select: [timeMs: number] }>()

const HOUR = 3_600_000
const STEP = 10
const W = computed(() => Math.max(props.hours.length, 1) * STEP)
const H = 100

const shares = computed<Shares[]>(() => props.series ?? props.hours.map(hourShares))
/** The most likely outcome for an hour: the field's own status, or the largest share when fields are combined. */
const likely = (i: number) => { const s = shares.value[i]!; return !props.series ? props.hours[i]!.status : s.go >= s.caution && s.go >= s.stop ? 'GO' : s.caution >= s.stop ? 'CAUTION' : 'STOP' }
const x = (i: number) => i * STEP + STEP / 2
/** A filled band from the bottom up to a level per hour, drawn edge to edge. */
function band(level: (i: number) => number): string {
  const n = props.hours.length
  if (!n) return ''
  const pts = [`0,${H}`, `0,${H * (1 - level(0))}`, ...props.hours.map((_, i) => `${x(i)},${(H * (1 - level(i))).toFixed(1)}`), `${W.value},${H * (1 - level(n - 1))}`, `${W.value},${H}`]
  return pts.join(' ')
}
const goBand = computed(() => band(i => shares.value[i]!.go))
const cautionBand = computed(() => band(i => shares.value[i]!.go + shares.value[i]!.caution))
const t0 = computed(() => props.hours[0]?.timeMs ?? 0)
const at = (ms: number) => Math.min(Math.max(((ms - t0.value) / HOUR) * STEP, 0), W.value)
const color = { GO: 'var(--go)', CAUTION: 'var(--caution)', STOP: 'var(--stop)' } as const
const dayAt = (i: number) => (i === 0 || fmtDay(props.hours[i]!.timeMs) !== fmtDay(props.hours[i - 1]!.timeMs) ? fmtDay(props.hours[i]!.timeMs) : '')

function pick(e: MouseEvent) {
  const box = (e.currentTarget as SVGElement).getBoundingClientRect()
  const i = Math.min(Math.max(Math.floor(((e.clientX - box.left) / box.width) * props.hours.length), 0), props.hours.length - 1)
  const h = props.hours[i]
  if (h) emit('select', h.timeMs)
}
</script>

<template>
  <div class="cchart">
    <svg :viewBox="`0 -8 ${W} ${H + 18}`" preserveAspectRatio="none" :style="{ height: `${height}px` }" role="img" aria-label="Share of outcomes that are sprayable, marginal or closed for each hour ahead. Click an hour to preview it." @click="pick">
      <rect x="0" y="0" :width="W" :height="H" fill="var(--stop)" />
      <polygon :points="cautionBand" fill="var(--caution)" />
      <polygon :points="goBand" fill="var(--go)" />
      <!-- The windows the whole job fits in. -->
      <rect v-for="w in windows" :key="w.startMs" :x="at(w.startMs)" y="-7" :width="Math.max(at(w.endMs) - at(w.startMs), 2)" height="4" fill="var(--ink)" />
      <!-- The single most likely outcome for each hour. -->
      <rect v-for="(h, i) in hours" :key="h.timeMs" :x="i * STEP" :y="H + 3" :width="STEP" height="6" :fill="color[likely(i)]" />
      <line v-if="nowMs && hours.length" :x1="at(nowMs)" :x2="at(nowMs)" y1="-8" :y2="H + 10" stroke="var(--cold)" stroke-width="1.2" vector-effect="non-scaling-stroke" />
      <rect v-if="selected && hours.some(h => h.timeMs === selected)" :x="at(selected)" y="0" :width="STEP" :height="H" fill="rgba(255,255,255,.14)" stroke="var(--ink)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
    </svg>
    <div v-if="labels" class="caxis">
      <span v-for="(h, i) in hours" :key="h.timeMs"><b v-if="dayAt(i)">{{ dayAt(i) }}</b><template v-else-if="i % 3 === 0">{{ fmtHour(h.timeMs) }}</template></span>
    </div>
  </div>
</template>

<style scoped>
.cchart { min-width: 0; }
svg { display: block; width: 100%; cursor: pointer; border-radius: 2px; }
.caxis { display: flex; margin-top: 3px; }
.caxis span { flex: 1; min-width: 0; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: visible; }
.caxis b { color: var(--ink); font-weight: 600; }
</style>
