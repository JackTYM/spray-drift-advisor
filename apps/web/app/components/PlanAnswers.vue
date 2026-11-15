<script setup lang="ts">
import { outlook, tripCost, vaporNote, type PlanHour } from '@drift/engine'

const props = defineProps<{
  hours: PlanHour[]
  window: { startMs: number; latestStartMs: number; endMs: number; confidence: number } | null
  jobMinutes: number
  nowMs: number
  tripCostUsd: number
  volatile?: boolean
}>()

const o = computed(() => outlook(props.hours, props.window, props.jobMinutes, props.nowMs))
const arrow = computed(() => (o.value.trend === 'improving' ? '↑' : o.value.trend === 'worsening' ? '↓' : '→'))
const trendWord = computed(() => (o.value.trend === 'improving' ? 'Getting better' : o.value.trend === 'worsening' ? 'Getting worse' : 'About the same'))
const cost = computed(() => (props.window ? tripCost(props.window.confidence, props.tripCostUsd) : null))
const inTen = computed(() => (props.window ? Math.round((1 - props.window.confidence) * 10) : null))
const vapor = computed(() => (props.volatile ? vaporNote(props.hours, props.window?.startMs ?? props.nowMs) : null))
</script>

<template>
  <dl class="answers">
    <div>
      <dt>What is the concern?</dt>
      <dd>{{ o.concern ?? 'Nothing is in the way right now.' }}</dd>
    </div>
    <div>
      <dt>Getting better or worse?</dt>
      <dd><span class="arrow" :class="o.trend">{{ arrow }}</span> {{ trendWord }}. {{ o.trendText }}</dd>
    </div>
    <div>
      <dt>When should I check again?</dt>
      <dd>{{ fmtWhen(o.checkAgainMs, nowMs) }}. {{ o.checkAgainWhy }}</dd>
    </div>
    <div>
      <dt>Could it change during my job?</dt>
      <dd>{{ o.duringJob }}</dd>
    </div>
    <div>
      <dt>Is the wind different higher up?</dt>
      <dd>{{ o.windAtHeight }}</dd>
    </div>
    <div v-if="o.sixHour">
      <dt>In 6 hours?</dt>
      <dd><span class="chip" :class="o.sixHour.status">{{ o.sixHour.status }}</span> {{ o.sixHour.text }}</dd>
    </div>
    <div v-if="window && cost !== null">
      <dt>If I drive out and can't finish</dt>
      <dd>About ${{ cost }} expected. {{ inTen }} in 10 chance the job cannot finish.</dd>
    </div>
    <div v-if="vapor">
      <dt>Product that gives off vapor</dt>
      <dd>{{ vapor }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.answers { margin: 0; display: grid; gap: 12px; }
.answers dt { color: var(--muted); font-size: 13px; margin: 0 0 2px; }
.answers dd { margin: 0; font-size: 15px; line-height: 1.4; }
.arrow { font-weight: 700; }
.arrow.improving { color: var(--go); }
.arrow.worsening { color: var(--stop); }
</style>
