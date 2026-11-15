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
