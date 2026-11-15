<script setup lang="ts">
import { BLOCKS } from '@drift/engine'

const { snap, api } = useRanch()
const selected = ref('block-3')
const history = ref<{ history: any[]; forecast: any[] }>({ history: [], forecast: [] })
const log = ref<any[]>([])
const sessions = ref<any[]>([])
const alerts = ref<any[]>([])
const backtest = ref<any>(null)

async function refresh() {
  try {
    const [h, l, s, a] = await Promise.all([
      $fetch<any>(`${api}/api/blocks/${selected.value}/history`),
      $fetch<any[]>(`${api}/api/log?limit=60`),
      $fetch<any[]>(`${api}/api/sessions`),
      $fetch<any[]>(`${api}/api/alerts`),
    ])
    history.value = h; log.value = l; sessions.value = s; alerts.value = a
  } catch { /* keep the last data */ }
}
let timer: ReturnType<typeof setInterval>
onMounted(async () => {
  refresh()
  timer = setInterval(refresh, 5000)
  backtest.value = await $fetch(`${api}/api/backtest`).catch(() => null)
})
onBeforeUnmount(() => clearInterval(timer))
watch(selected, refresh)

const blockName = (id: string) => BLOCKS.find(b => b.id === id)?.name ?? id
const reason = (b: any) => b.evaluation?.triggers[0]?.text ?? 'No inversion; wind within limits.'
const levels = (row: any) => (row.levels ?? []).map((l: any) => `${l.heightFt} ft: ${l.tempF}°F, ${l.windMph} mph`).join(' · ')
</script>

<template>
  <main class="wide">
    <div class="grid3">
      <button v-for="b in snap?.blocks ?? []" :key="b.id" class="card" style="text-align:left;cursor:pointer;font:inherit;color:inherit"
        :style="{ outline: selected === b.id ? '3px solid #1c2530' : 'none' }" @click="selected = b.id">
        <div class="label">{{ b.name }} · {{ b.note }}</div>
        <span class="chip" :class="b.evaluation?.status ?? 'CAUTION'">{{ b.evaluation?.status ?? '...' }}</span>
        <div class="muted" style="margin-top:6px">{{ reason(b) }}</div>
      </button>
    </div>

    <div class="grid2">
      <section class="card">
        <div class="label">{{ blockName(selected) }}: temperature at both heights, with forecast</div>
        <Timeline :history="history.history" :forecast="history.forecast" />
      </section>

      <section class="card">
        <div class="label">Compared with a single ground station</div>
        <template v-if="backtest">
          <div class="headline">{{ backtest.result.missedNights.length }} of {{ backtest.result.nightsCompared }} nights</div>
          <div>had an inversion aloft while the {{ snap?.ground?.station ?? 'ground' }} station's wind looked fine for spraying.</div>
          <div class="muted">{{ backtest.label }}. {{ backtest.result.missedHours }} hours in total. Model-indicated inversion: upper-air temperatures come from Open-Meteo's historical forecast, not a tower.</div>
        </template>
        <div v-else class="muted">No backtest has been run yet.</div>
      </section>
    </div>

    <section class="card">
      <div class="label">Spray jobs</div>
      <div v-if="!sessions.length" class="muted">No jobs yet.</div>
      <div v-for="s in sessions" :key="s.id" class="trigger">
        <strong>{{ blockName(s.blockId) }}</strong> · {{ s.job.product }} · {{ s.phase }} · started {{ fmtStamp(s.startedMs) }}
        <span v-if="s.overrideReason"> · override: {{ s.overrideReason }}</span>
        · <NuxtLink :to="`/record/${s.id}`">record</NuxtLink>
        · <a :href="`${api}/api/sessions/${s.id}/record?format=csv`">CSV</a>
      </div>
      <div class="label" style="margin-top:12px">Alerts sent</div>
      <div v-if="!alerts.length" class="muted">None.</div>
      <div v-for="a in alerts.slice(0, 8)" :key="a.id" class="trigger">
        {{ fmtStamp(a.time) }} · {{ a.kind }} · {{ a.channel }} to {{ a.recipient }} · {{ a.ok ? 'delivered' : 'failed: ' + a.detail }}
      </div>
    </section>

    <section class="card">
      <div class="label">Log: every evaluation, time-stamped</div>
      <div class="tablewrap">
        <table>
          <thead><tr><th>Time</th><th>Block</th><th>Status</th><th>Ground only</th><th>Triggered by</th><th>Readings</th><th>Ri</th></tr></thead>
          <tbody>
            <tr v-for="row in log" :key="row.id">
              <td class="num">{{ fmtStamp(row.time) }}</td>
              <td>{{ blockName(row.block_id) }}</td>
              <td><span class="chip" :class="row.status">{{ row.status }}</span></td>
              <td><span class="chip" :class="row.ground_status">{{ row.ground_status }}</span></td>
              <td>{{ row.triggers.map((t: any) => t.text).join(' ') || 'None' }}</td>
              <td class="num">{{ levels(row) }}</td>
              <td class="num">{{ Number(row.ri).toFixed(2) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>
