<script setup lang="ts">
import { BLOCKS, scenarioById } from '@drift/engine'

const { snap, api } = useRanch()
const selected = ref('block-3')
const history = ref<{ history: any[]; forecast: any[] }>({ history: [], forecast: [] })
const log = ref<any[]>([])
const sessions = ref<any[]>([])
const alerts = ref<any[]>([])
const backtest = ref<any>(null)
const surroundings = useSurroundings(selected)
const block = computed(() => snap.value?.blocks.find(b => b.id === selected.value) ?? null)
const marks = computed(() => (snap.value?.demo.mode === 'scenario' ? scenarioById(snap.value.demo.scenarioId).marks : []))
const jump = (min: number) => $fetch(`${api}/api/demo`, { method: 'POST', body: { seekMin: min } }).then(refresh)

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
    <div v-if="marks.length" class="jumps">
      <span class="muted">Jump to</span>
      <button v-for="m in marks" :key="m.label" @click="jump(m.min)">{{ m.label }}</button>
      <span class="muted">{{ snap ? fmtStamp(snap.nowMs) : '' }}, scripted night</span>
    </div>
    <div class="grid3">
      <button v-for="b in snap?.blocks ?? []" :key="b.id" class="card tile" :class="[b.evaluation?.status, { selected: selected === b.id }]" @click="selected = b.id">
        <div class="name">{{ b.name }} <span class="muted">{{ b.note.toLowerCase() }}</span></div>
        <div class="state">{{ b.evaluation?.status ?? 'WAIT' }}</div>
        <div>{{ reason(b) }}</div>
      </button>
    </div>

    <div class="grid2">
      <section class="card">
        <h2>What is downwind of {{ blockName(selected) }}</h2>
        <BlockMap :blocks="snap?.blocks ?? []" :selected="selected" :surroundings="surroundings" @select="selected = $event" />
      </section>
      <div>
        <section class="card">
        <h2>{{ blockName(selected) }}: temperature at both heights</h2>
        <Timeline :history="history.history" :forecast="history.forecast" />
      </section>
        <section class="card">
        <h2>What a ground station misses</h2>
        <template v-if="backtest">
          <div class="headline">{{ backtest.result.missedNights.length }} of {{ backtest.result.nightsCompared }} nights</div>
          <div>had an inversion aloft while the {{ snap?.ground?.station ?? 'ground' }} station's wind looked fine for spraying.</div>
          <div class="muted">{{ backtest.label }}. {{ backtest.result.missedHours }} hours in total. Model-indicated inversion: upper-air temperatures come from Open-Meteo's historical forecast, not a tower.</div>
        </template>
        <div v-else class="muted">No backtest has been run yet.</div>
      </section>
      </div>
    </div>

    <section class="card">
      <h2>One ground station compared with two heights</h2>
      <CompareTable :block="block" :ground="snap?.ground ?? null" />
    </section>

    <div class="grid2">
      <section class="card">
        <h2>Vertical profile at {{ blockName(selected) }}</h2>
        <VerticalProfile :reading="block?.reading ?? null" />
      </section>
      <section class="card">
        <h2>Wind at both heights</h2>
        <Hodograph :reading="block?.reading ?? null" />
      </section>
    </div>

    <section class="card">
      <h2>How the numbers were worked out</h2>
      <CalcDetails :reading="block?.reading ?? null" :ground="snap?.ground ?? null" />
    </section>

    <section class="card">
      <h2>Spray jobs</h2>
      <div v-if="!sessions.length" class="muted">No jobs yet.</div>
      <div v-for="s in sessions" :key="s.id" class="trigger plain">
        <strong>{{ blockName(s.blockId) }}</strong> · {{ s.job.product }} · {{ s.phase }} · started {{ fmtStamp(s.startedMs) }}
        <span v-if="s.overrideReason"> · override: {{ s.overrideReason }}</span>
        · <NuxtLink :to="`/record/${s.id}`">record</NuxtLink>
        · <a :href="`${api}/api/sessions/${s.id}/record?format=csv`">CSV</a>
      </div>
      <h2 style="margin-top:16px">Alerts sent</h2>
      <div v-if="!alerts.length" class="muted">None.</div>
      <div v-for="a in alerts.slice(0, 8)" :key="a.id" class="trigger plain">
        {{ fmtStamp(a.time) }} · {{ a.kind }} · {{ a.channel }} to {{ a.recipient }} · {{ a.ok ? 'delivered' : 'failed: ' + a.detail }}
      </div>
    </section>

    <section class="card">
      <h2>Log of every evaluation</h2>
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
