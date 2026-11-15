<script setup lang="ts">
const api = useRuntimeConfig().public.apiBase as string
const rows = ref<any[]>([])
const alerts = ref<any[]>([])
const evals = ref<any[]>([])
const error = ref('')
const adding = ref(false)
async function load() {
  try {
    const [r, a, e] = await Promise.all([$fetch<any[]>(`${api}/api/spraylog`), $fetch<any[]>(`${api}/api/alerts`), $fetch<any[]>(`${api}/api/log?limit=120`)])
    rows.value = r; alerts.value = a; evals.value = e; error.value = ''
  } catch { error.value = 'The records could not be loaded.' }
}
let timer: ReturnType<typeof setInterval>
onMounted(() => { load(); timer = setInterval(load, 10_000) })
onBeforeUnmount(() => clearInterval(timer))
const levels = (row: any) => (row.levels ?? []).map((l: any) => `${l.heightFt} ft: ${l.tempF}°F, ${l.windMph} mph`).join(', ')
const blockOf = (id: string) => id.replace('block-', 'Block ')
const label = (o: string) => (o === 'not-sprayed' ? 'Did not spray' : o === 'waiting' ? 'Waiting' : 'Sprayed')
</script>

<template>
  <main class="wide">
    <section class="card">
      <div class="cardhead">
        <h1>Spray log</h1>
        <div style="display:flex;gap:10px">
          <button class="btn" style="width:auto;margin:0" @click="adding = !adding">{{ adding ? 'Close' : 'Add a record' }}</button>
          <a class="btn secondary" style="width:auto;margin:0;text-decoration:none;display:inline-flex;align-items:center" :href="`${api}/api/spraylog?format=csv`">Download CSV</a>
        </div>
      </div>
      <p class="muted">Every job and every decision not to spray, with the conditions the tower measured when it started and stopped. Jobs started from the <NuxtLink to="/now">Now</NuxtLink> screen are logged as they run; use "Add a record" for anything that was not. The download adds the application details, coordinates and acreage for each row.</p>
      <RecordForm v-if="adding" @saved="adding = false; load()" @cancel="adding = false" />
      <div v-if="error" class="error" role="alert">{{ error }}</div>
      <div v-else-if="!rows.length && !adding" class="muted">Nothing logged yet. Add a record here, or start a job from the Now screen.</div>
      <div v-else class="tablewrap">
        <table>
          <thead>
            <tr><th>Outcome</th><th>Block</th><th>Started</th><th>Stopped</th><th>Applicator</th><th>Product</th><th>At start</th><th>At stop</th><th>Worst during</th><th>Alerts</th><th>Notes</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td><strong>{{ label(r.outcome) }}</strong><div v-if="r.enteredLater" class="muted">Entered afterwards</div></td>
              <td>{{ r.block }}<div class="muted">{{ r.acres }} acres</div></td>
              <td class="num">{{ r.started }}</td>
              <td class="num">{{ r.stopped || '' }}<div v-if="r.minutes !== null" class="muted">{{ r.minutes }} min</div></td>
              <td>{{ r.job.applicatorName || 'Not recorded' }}<div v-if="r.job.licenseNo" class="muted">{{ r.job.licenseNo }}</div></td>
              <td>{{ r.job.product }}<div v-if="r.job.epaRegNo" class="muted">EPA {{ r.job.epaRegNo }}</div></td>
              <td>
                <template v-if="r.atStart"><span class="chip" :class="r.atStart.status">{{ r.atStart.status }}</span>
                  <div class="muted">{{ r.atStart.low }}</div><div class="muted">{{ r.atStart.high }}</div>
                  <div class="muted">Inversion: {{ r.atStart.inversion }}</div></template>
              </td>
              <td>
                <template v-if="r.atStop"><span class="chip" :class="r.atStop.status">{{ r.atStop.status }}</span>
                  <div class="muted">{{ r.atStop.low }}</div><div class="muted">{{ r.atStop.high }}</div></template>
              </td>
              <td><span v-if="r.worstDuring" class="chip" :class="r.worstDuring">{{ r.worstDuring }}</span></td>
              <td class="num">{{ r.alerts }}</td>
              <td>
                <div v-if="r.overrideReason">Override: {{ r.overrideReason }}</div>
                <div v-if="r.holdReason">{{ r.holdReason }}</div>
                <div v-if="r.reentryAllowed" class="muted">Re-entry from {{ r.reentryAllowed }}</div>
              </td>
              <td><NuxtLink :to="`/record/${r.id}`">Record</NuxtLink></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <section class="card">
      <h2>Alerts sent</h2>
      <div v-if="!alerts.length" class="muted">None yet.</div>
      <div v-for="a in alerts.slice(0, 12)" :key="a.id" class="trigger plain">
        {{ fmtStamp(a.time) }}: {{ a.kind }} by {{ a.channel }} to {{ /^\+?\d{7,}$/.test(a.recipient ?? '') ? `a phone ending ${String(a.recipient).slice(-4)}` : a.recipient }}, {{ a.ok ? 'delivered' : 'failed (' + a.detail + ')' }}. <span class="muted">{{ a.title }}</span>
      </div>
    </section>

    <section class="card">
      <details>
        <summary><h2 style="display:inline">Every evaluation ({{ evals.length }} most recent)</h2></summary>
        <div class="tablewrap" style="margin-top:12px">
          <table>
            <thead><tr><th>Time</th><th>Block</th><th>Status</th><th>Ground only</th><th>Triggered by</th><th>Readings</th><th>Ri</th></tr></thead>
            <tbody>
              <tr v-for="row in evals" :key="row.id">
                <td class="num">{{ fmtStamp(row.time) }}</td><td>{{ blockOf(row.block_id) }}</td>
                <td><span class="chip" :class="row.status">{{ row.status }}</span></td>
                <td><span class="chip" :class="row.ground_status">{{ row.ground_status }}</span></td>
                <td>{{ row.triggers.map((t: any) => t.text).join(' ') || 'None' }}</td>
                <td class="num">{{ levels(row) }}</td><td class="num">{{ Number(row.ri).toFixed(2) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </section>
  </main>
</template>
