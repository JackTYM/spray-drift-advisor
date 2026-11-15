<script setup lang="ts">
import type { PlanHour } from '@drift/engine'

const props = defineProps<{ hours: PlanHour[] }>()
const emit = defineEmits<{
  go: [step: { fieldId?: string; pickedMs?: number | null; stage?: 'map' | '3d'; tab?: string; advanced?: boolean }]
}>()

const open = ref(false)
const idx = ref(0)

const mentions = (h: PlanHour, words: string[]) =>
  (h.reasons ?? []).some((r) => words.some((w) => String(r).toLowerCase().includes(w)))

const firstMs = () => props.hours[0]?.timeMs ?? null

const inversionMs = () =>
  props.hours.find((h) => h.status === 'STOP' && mentions(h, ['inversion', 'warmer']))?.timeMs ?? firstMs()

/** An hour closed by wind toward buildings alone, so the reason on screen matches the script. */
const buildingHour = () => props.hours.find((h) => mentions(h, ['buildings', 'homes']) && !mentions(h, ['inversion', 'warmer'])) ?? props.hours.find((h) => mentions(h, ['buildings', 'homes']))

const steps = computed(() => {
  const b = buildingHour()
  const stop = props.hours.find((h) => h.status === 'STOP')
  return [
    {
      rubric: 'Tiebreaker: better than one station',
      title: 'One station sees one point at one height',
      text: 'About 24 public stations surround this field. The chart shows, measured right now, how far off you would be using only the nearest one, the forecast alone, or our estimate.',
      go: { fieldId: 'block-3', pickedMs: null, stage: 'map' as const, tab: 'station', advanced: false },
    },
    {
      rubric: 'Real-world usefulness',
      title: 'The window your whole job fits in',
      text: 'A crew that has started does not stop. The placard gives the soonest start a 45 minute job fits, the latest start that still finishes, and how sure we are.',
      go: { tab: 'route', stage: 'map' as const },
    },
    {
      rubric: 'Drift-risk detection',
      title: 'An inversion a ground station cannot see',
      text: 'Light wind, so a single station says go. Warmer air sits on top of cooler air at the ground, which holds spray low and carries it. Green dots land on the block, purple dots land off it.',
      go: { pickedMs: inversionMs(), stage: '3d' as const },
    },
    {
      rubric: 'Drift-risk detection',
      title: 'Wind toward the neighbours',
      text: b
        ? 'Wind inside the limits, but blowing at the buildings beside the block. The plan closes the hour and says why.'
        : 'The 3D view shows where spray would go at any hour, including the hours the plan closes.',
      go: { pickedMs: (b ?? stop)?.timeMs ?? firstMs(), stage: '3d' as const },
    },
    {
      rubric: 'Real-world usefulness',
      title: 'Why this field is different',
      text: 'This block sits low on the valley floor, where cold air pools, so it inverts earlier and harder than the regional forecast. Add any field and get the same read.',
      go: { pickedMs: null, tab: 'micro', stage: 'map' as const },
    },
    {
      rubric: 'Real-world usefulness',
      title: 'Plan the whole night',
      text: 'Every field on one chart, and a route that puts each job inside its window with drive time, shows what it costs, and says which fields to put off.',
      go: { tab: 'route', stage: 'map' as const },
    },
    {
      rubric: 'Alerts and records',
      title: 'It reaches the crew, and keeps the record',
      text: 'Press "Text the team this plan" and the text arrives. Reply with a question and the assistant answers from this plan. Every job and every decision not to spray is in Records.',
      go: { tab: 'route', stage: 'map' as const },
    },
    {
      rubric: 'Execution and honesty',
      title: 'Check the working',
      text: 'Live data, deployed, every figure labelled measured, estimated or modelled. The working behind the confidence figure is one click away, with its limits stated.',
      go: { advanced: true, tab: 'confidence' },
    },
  ]
})

function show(i: number) {
  idx.value = i
  emit('go', steps.value[i]!.go)
}
function start() {
  open.value = true
  show(0)
}
function next() {
  if (idx.value < steps.value.length - 1) show(idx.value + 1)
}
function back() {
  if (idx.value > 0) show(idx.value - 1)
}
function exit() {
  open.value = false
}
function onKey(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'ArrowRight') { e.preventDefault(); next() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); back() }
  else if (e.key === 'Escape') exit()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <button v-if="!open" type="button" class="gd-open" @click="start">Walkthrough</button>
  <div v-else class="gd-bar" role="region" aria-label="Guided demo">
    <div class="gd-count">{{ idx + 1 }} of {{ steps.length }}</div>
    <div class="gd-body">
      <span class="gd-rubric">{{ steps[idx]!.rubric }}</span>
      <strong class="gd-title">{{ steps[idx]!.title }}</strong>
      <p class="gd-text">{{ steps[idx]!.text }}</p>
    </div>
    <div class="gd-btns">
      <button type="button" :disabled="idx === 0" @click="back">Back</button>
      <button type="button" class="primary" :disabled="idx === steps.length - 1" @click="next">Next</button>
      <button type="button" @click="exit">Exit</button>
    </div>
  </div>
</template>

<style scoped>
.gd-open { font: 700 17px var(--display); letter-spacing: .03em; color: var(--ink); background: transparent; border: 2px solid var(--ink); border-radius: 4px; padding: 8px 16px; cursor: pointer; margin-bottom: 12px; }
.gd-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 20px; width: 100%; background: var(--panel-2); border: 2px solid var(--ink); border-radius: 6px; padding: 10px 16px; margin-bottom: 12px; }
.gd-count { font: 700 16px var(--display); color: var(--muted); white-space: nowrap; }
.gd-body { flex: 1 1 380px; min-width: 0; }
.gd-rubric { display: block; font: 700 13px var(--text); letter-spacing: .08em; text-transform: uppercase; color: var(--warm); }
.gd-title { display: block; font: 700 22px var(--display); color: var(--ink); }
.gd-text { margin: 2px 0 0; font: 400 18px/1.35 var(--text); color: var(--ink); }
.gd-btns { display: flex; gap: 8px; }
.gd-btns button { font: 600 16px var(--text); color: var(--ink); background: transparent; border: 1px solid var(--line); border-radius: 4px; padding: 8px 16px; cursor: pointer; }
.gd-btns button.primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.gd-btns button:disabled { opacity: .35; cursor: default; }
</style>
