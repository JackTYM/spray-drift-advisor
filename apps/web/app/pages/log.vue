<script setup lang="ts">
const api = useRuntimeConfig().public.apiBase as string
const rows = ref<any[]>([])
const error = ref('')
async function load() {
  try { rows.value = await $fetch<any[]>(`${api}/api/spraylog`); error.value = '' } catch { error.value = 'The spray log could not be loaded.' }
}
let timer: ReturnType<typeof setInterval>
onMounted(() => { load(); timer = setInterval(load, 10_000) })
onBeforeUnmount(() => clearInterval(timer))
const label = (o: string) => (o === 'not-sprayed' ? 'Did not spray' : o === 'waiting' ? 'Waiting' : 'Sprayed')
</script>

<template>
  <main class="wide">
    <section class="card">
      <div class="cardhead">
        <h1>Spray log</h1>
        <a class="btn" style="width:auto;margin:0;text-decoration:none;display:inline-flex;align-items:center" :href="`${api}/api/spraylog?format=csv`">Download CSV</a>
      </div>
      <p class="muted">Every job and every decision not to spray, with the conditions the tower measured when it started and stopped. The download adds the application details, coordinates and acreage for each row.</p>
      <div v-if="error" class="error" role="alert">{{ error }}</div>
      <div v-else-if="!rows.length" class="muted">Nothing logged yet. Start a job, or log that you are not spraying, from the Applicator screen.</div>
      <div v-else class="tablewrap">
        <table>
          <thead>
            <tr><th>Outcome</th><th>Block</th><th>Started</th><th>Stopped</th><th>Applicator</th><th>Product</th><th>At start</th><th>At stop</th><th>Worst during</th><th>Alerts</th><th>Notes</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td><strong>{{ label(r.outcome) }}</strong></td>
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
  </main>
</template>
