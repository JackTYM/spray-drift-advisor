<script setup lang="ts">
import type { Status } from '@drift/engine'

interface Row { time: string; status: Status; ground_status?: Status; levels: { heightFt: number; tempF: number }[] | null }
const props = defineProps<{ history: Row[]; forecast: { timeMs: number; status: Status }[] }>()
const W = 640, H = 262, TOP = 12, BOTTOM = 130, GROUND_ROW = 158, STRIP = 196
const color: Record<Status, string> = { GO: '#2fbf71', CAUTION: '#f0b429', STOP: '#d93a26' }

const points = computed(() => sinceLastJump(props.history.filter(r => r.levels && r.levels.length >= 2).map(r => {
  const s = [...r.levels!].sort((a, b) => a.heightFt - b.heightFt)
  return { t: Date.parse(r.time), lo: s[0].tempF, hi: s[s.length - 1].tempF, status: r.status, ground: r.ground_status ?? r.status }
})))
/** Keeps the trailing run of readings whose times only move forward. */
function sinceLastJump<T extends { t: number }>(rows: T[]): T[] {
  let start = 0
  for (let i = 1; i < rows.length; i++) if (rows[i]!.t < rows[i - 1]!.t) start = i
  return rows.slice(start)
}
const range = computed(() => {
  const ts = [...points.value.map(p => p.t), ...props.forecast.map(f => f.timeMs)]
  const temps = points.value.flatMap(p => [p.lo, p.hi])
  return { t0: Math.min(...ts), t1: Math.max(...ts) + 1, min: Math.min(...temps) - 1, max: Math.max(...temps) + 1 }
})
const x = (t: number) => 8 + ((t - range.value.t0) / (range.value.t1 - range.value.t0)) * (W - 16)
const y = (f: number) => BOTTOM - ((f - range.value.min) / (range.value.max - range.value.min)) * (BOTTOM - TOP)
const line = (key: 'lo' | 'hi') => points.value.map(p => `${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
const stripWidth = (i: number, arr: { t: number }[]) => Math.max((i + 1 < arr.length ? x(arr[i + 1].t) : x(arr[i].t) + 4) - x(arr[i].t), 1)
const fc = computed(() => props.forecast.map(f => ({ t: f.timeMs, status: f.status })))
const nowX = computed(() => (points.value.length ? x(points.value[points.value.length - 1].t) : 0))
</script>

<template>
  <div v-if="points.length < 2" class="muted">Waiting for readings.</div>
  <svg v-else :viewBox="`0 0 ${W} ${H}`" width="100%" role="img" aria-label="Temperature at the lowest and highest tower levels over time, with a status strip that continues into the forecast">
    <polyline :points="line('lo')" fill="none" stroke="#6cb8f0" stroke-width="2.2" />
    <polyline :points="line('hi')" fill="none" stroke="#f2994a" stroke-width="2.2" />
    <text x="8" :y="GROUND_ROW - 5" font-size="13" fill="#93a5bb">One ground station</text>
    <rect v-for="(p, i) in points" :key="'g' + i" :x="x(p.t)" :y="GROUND_ROW" :width="stripWidth(i, points)" height="12" :fill="color[p.ground]" />
    <text x="8" :y="STRIP - 5" font-size="13" fill="#93a5bb">Two heights, continuing into the forecast (paler)</text>
    <rect v-for="(p, i) in points" :key="'h' + i" :x="x(p.t)" :y="STRIP" :width="stripWidth(i, points)" height="12" :fill="color[p.status]" />
    <rect v-for="(f, i) in fc" :key="'f' + i" :x="x(f.t)" :y="STRIP" :width="stripWidth(i, fc)" height="12" :fill="color[f.status]" opacity="0.45" />
    <line :x1="nowX" :x2="nowX" :y1="TOP" :y2="STRIP + 12" stroke="#e9eff6" stroke-dasharray="3 3" />
    <text :x="nowX + 4" :y="BOTTOM + 14" font-size="13" fill="#e9eff6">now</text>
    <text x="8" :y="H - 8" font-size="13" fill="#93a5bb">{{ fmtTime(range.t0) }}</text>
    <text :x="W - 8" :y="H - 8" font-size="13" fill="#93a5bb" text-anchor="end">{{ fmtTime(range.t1) }}</text>
    <text x="8" :y="TOP + 10" font-size="13" fill="#6cb8f0">lowest level</text>
    <text x="110" :y="TOP + 10" font-size="13" fill="#f2994a">highest level</text>
  </svg>
</template>
