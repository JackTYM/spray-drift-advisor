<script setup lang="ts">
import { SCENARIOS } from '@drift/engine'

const { snap, api } = useRanch()
const mode = ref<'live' | 'scenario' | 'replay'>('scenario')
const scenarioId = ref(SCENARIOS[0].id)
const replayDate = ref('2025-01-10')
const stepMin = ref(5)
const message = ref('')

async function apply(reset: boolean) {
  const r = await $fetch<any>(`${api}/api/demo`, { method: 'POST', body: { mode: mode.value, scenarioId: scenarioId.value, replayDate: replayDate.value, stepMin: stepMin.value, reset } })
  message.value = r.error ?? `Now in ${r.demo.mode} mode.`
}
const speed = () => $fetch(`${api}/api/demo`, { method: 'POST', body: { stepMin: stepMin.value } })
</script>

<template>
  <main class="phone pad">
    <div class="card">
      <div class="label">Demo control</div>
      <select v-model="mode" aria-label="Mode">
        <option value="live">Live: today's real weather</option>
        <option value="scenario">Scenario: scripted night</option>
        <option value="replay">Replay: a real past night</option>
      </select>
      <select v-if="mode === 'scenario'" v-model="scenarioId" aria-label="Scenario">
        <option v-for="s in SCENARIOS" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
      <input v-if="mode === 'replay'" v-model="replayDate" type="date" aria-label="Replay date">
      <div class="label">Simulated minutes per 2-second tick</div>
      <select v-model.number="stepMin" aria-label="Speed" @change="speed">
        <option :value="1">1</option><option :value="5">5</option><option :value="15">15</option><option :value="30">30</option>
      </select>
      <button class="btn" @click="apply(false)">Apply</button>
      <button class="btn secondary" @click="apply(true)">Apply and clear the log</button>
      <div class="muted">{{ message }}</div>
      <div class="muted">Simulated time: {{ snap ? fmtStamp(snap.nowMs) : '...' }}</div>
    </div>
  </main>
</template>
