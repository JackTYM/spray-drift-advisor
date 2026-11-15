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

const buildingHour = () => props.hours.find((h) => mentions(h, ['buildings', 'homes']))

const steps = computed(() => {
  const b = buildingHour()
  const stop = props.hours.find((h) => h.status === 'STOP')
  return [
    {
      title: 'One station, one height',
      text: 'A weather station sees one point at one height. Here are the 24 stations around this field, and how far off you would be using only the nearest one.',
      go: { fieldId: 'block-3', pickedMs: null, stage: 'map' as const, tab: 'station', advanced: false },
    },
    {
      title: 'The window your job fits in',
      text: 'The placard gives the soonest start a 45 minute job fits, the latest start that still finishes, and how sure we are, because a crew that has started does not stop.',
      go: { tab: 'route', stage: 'map' as const },
    },
    {
      title: 'An hour that looks fine but is not',
      text: 'Tonight the wind is light and a single station would say go. The air above is warmer than the air at the ground, which holds spray low and carries it.',
      go: { pickedMs: inversionMs(), stage: '3d' as const },
    },
    {
      title: 'Wind toward the neighbours',
      text: b
        ? 'This hour the wind carries spray toward the buildings at the edge of the block, so the plan closes it. The 3D view shows why.'
        : 'The 3D view shows where spray would go at any hour, including the hours the plan closes.',
      go: { pickedMs: (b ?? stop)?.timeMs ?? firstMs(), stage: '3d' as const },
    },
    {
      title: 'Why this field is different',
      text: 'This block sits low on the valley floor, where cold air pools, so it inverts earlier and harder than the regional forecast.',
      go: { tab: 'micro', stage: 'map' as const },
    },
    {
      title: 'Check the working',
      text: 'Everything behind the confidence figure is one click away, measured live, with its limits stated.',
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
  <button v-if="!open" type="button" class="gd-open" @click="start">Guided demo</button>
  <div v-else class="gd-bar" role="region" aria-label="Guided demo">
    <div class="gd-count">{{ idx + 1 }} of {{ steps.length }}</div>
    <div class="gd-body">
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
.gd-open { font: 700 17px var(--display); letter-spacing: .03em; color: var(--ink); background: transparent; border: 2px solid var(--ink); border-radius: 4px; padding: 8px 16px; cursor: pointer; }
.gd-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 20px; width: 100%; background: var(--panel-2); border: 2px solid var(--ink); border-radius: 6px; padding: 10px 16px; margin-bottom: 12px; }
.gd-count { font: 700 16px var(--display); color: var(--muted); white-space: nowrap; }
.gd-body { flex: 1 1 380px; min-width: 0; }
.gd-title { display: block; font: 700 22px var(--display); color: var(--ink); }
.gd-text { margin: 2px 0 0; font: 400 18px/1.35 var(--text); color: var(--ink); }
.gd-btns { display: flex; gap: 8px; }
.gd-btns button { font: 600 16px var(--text); color: var(--ink); background: transparent; border: 1px solid var(--line); border-radius: 4px; padding: 8px 16px; cursor: pointer; }
.gd-btns button.primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.gd-btns button:disabled { opacity: .35; cursor: default; }
</style>
