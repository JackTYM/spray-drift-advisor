<script setup lang="ts">
import { BLOCKS } from '@drift/engine'

const api = useRuntimeConfig().public.apiBase as string
const id = useRoute().params.id as string
const record = ref<any>(null)
const error = ref('')
onMounted(async () => {
  try { record.value = await $fetch(`${api}/api/sessions/${id}/record`) } catch { error.value = 'Record not found.' }
})
const changes = computed(() => (record.value?.evaluations ?? []).filter((e: any, i: number, all: any[]) => i === 0 || e.status !== all[i - 1].status))
const blockName = (b: string) => BLOCKS.find(x => x.id === b)?.name ?? b
const print = () => window.print()
</script>

<template>
  <main class="wide">
    <div v-if="error" class="error">{{ error }}</div>
    <template v-if="record">
      <section class="card">
        <h1 style="margin:0 0 6px">Spray job record</h1>
        <div>{{ blockName(record.session.blockId) }} · {{ record.session.job.product }} · {{ record.session.job.droplet }} droplets</div>
        <div>Started {{ fmtStamp(record.session.startedMs) }}<span v-if="record.session.finishedMs"> · finished {{ fmtStamp(record.session.finishedMs) }}</span> · {{ record.session.phase }}</div>
        <div v-if="record.session.overrideReason"><strong>Override reason:</strong> {{ record.session.overrideReason }}</div>
        <button class="btn" style="max-width:260px" @click="print">Print or save as PDF</button>
        <a :href="`${api}/api/sessions/${id}/record?format=csv`" class="muted">Download CSV</a>
      </section>

      <section class="card">
        <h2>Application details</h2>
        <div class="facts">
          <div><span>Outcome</span>{{ record.session.outcome === 'not-sprayed' ? 'Did not spray' : 'Sprayed' }}</div>
          <div><span>Applicator</span>{{ record.session.job.applicatorName || 'Not recorded' }}</div>
          <div><span>License or certificate no.</span>{{ record.session.job.licenseNo || 'Not recorded' }}</div>
          <div><span>EPA Reg. No.</span>{{ record.session.job.epaRegNo || 'Not recorded' }}</div>
          <div><span>Active ingredient</span>{{ record.session.job.activeIngredient || 'Not recorded' }}</div>
          <div><span>Rate per acre</span>{{ record.session.job.ratePerAcre || 'Not recorded' }}</div>
          <div><span>Target pest</span>{{ record.session.job.targetPest || 'Not recorded' }}</div>
          <div><span>Re-entry interval</span>{{ record.session.job.reiHours != null ? record.session.job.reiHours + ' hours' : 'Not recorded' }}</div>
          <div><span>Downwind sensitive areas checked</span>{{ record.session.job.sensitiveAreasChecked ? 'Yes' : 'Not recorded' }}</div>
        </div>
        <div v-if="record.session.holdReason"><strong>Reason for not spraying:</strong> {{ record.session.holdReason }}</div>
      </section>

      <section v-if="record.session.startConditions" class="card">
        <h2>Conditions at start and stop</h2>
        <div class="grid2">
          <div v-for="c in [{ label: record.session.outcome === 'not-sprayed' ? 'When they held off' : 'At start', v: record.session.startConditions }, { label: 'At stop', v: record.session.stopConditions }].filter(x => x.v)" :key="c.label">
            <div class="label">{{ c.label }}, {{ fmtStamp(c.v.timeMs) }}</div>
            <span class="chip" :class="c.v.status">{{ c.v.status }}</span>
            <span class="muted"> ground station alone: {{ c.v.groundStatus }}</span>
            <div v-for="l in c.v.levels" :key="l.heightFt">{{ l.heightFt }} ft: {{ l.tempF }}°F, wind {{ l.windMph }} mph from the {{ compass(l.windDirDeg) }}</div>
            <div>Temperature difference {{ c.v.deltaF > 0 ? '+' : '' }}{{ c.v.deltaF }}°F ({{ c.v.deltaF > 0 ? 'inversion' : 'no inversion' }}), Richardson number {{ c.v.ri }}</div>
            <div v-if="c.v.reasons.length" class="muted">{{ c.v.reasons.join(' ') }}</div>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Status changes</h2>
        <div v-for="e in changes" :key="e.id" class="trigger plain">
          <span class="num">{{ fmtStamp(e.time) }}</span> <span class="chip" :class="e.status">{{ e.status }}</span>
          {{ e.triggers.map((t: any) => t.text).join(' ') || 'No triggers.' }}
        </div>
      </section>

      <section class="card">
        <h2>Alerts sent</h2>
        <div v-if="!record.alerts.length" class="muted">None.</div>
        <div v-for="a in record.alerts" :key="a.id" class="trigger plain">{{ fmtStamp(a.time) }} · {{ a.kind }} · {{ a.channel }} to {{ a.recipient }} · {{ a.ok ? 'delivered' : 'failed' }} · {{ a.body }}</div>
      </section>

      <section class="card">
        <h2>All evaluations ({{ record.evaluations.length }})</h2>
        <div class="tablewrap">
          <table>
            <thead><tr><th>Time</th><th>Status</th><th>Ground only</th><th>Temp difference</th><th>Ri</th><th>Readings</th></tr></thead>
            <tbody>
              <tr v-for="e in record.evaluations" :key="e.id">
                <td class="num">{{ fmtStamp(e.time) }}</td><td>{{ e.status }}</td><td>{{ e.ground_status }}</td>
                <td class="num">{{ e.delta_f }}°F</td><td class="num">{{ Number(e.ri).toFixed(2) }}</td>
                <td class="num">{{ (e.levels ?? []).map((l: any) => `${l.heightFt} ft: ${l.tempF}°F ${l.windMph} mph`).join(' · ') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </main>
</template>
