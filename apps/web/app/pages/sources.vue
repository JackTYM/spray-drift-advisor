<script setup lang="ts">
const { snap, api } = useRanch()
const csv = ref(['timestamp,t_low_c,t_high_c,ws_low,ws_high,wd_low,wd_high', '2026-11-17T05:00:00-07:00,10,14,1.5,2.2,280,265', '2026-11-17T05:05:00-07:00,10,13.8,1.6,2.3,281,266'].join('\n'))
const mapping = ref(JSON.stringify({
  blockId: 'import', source: 'my-logger.csv', time: 'timestamp',
  levels: [
    { heightFt: 5, temp: 't_low_c', tempUnit: 'C', wind: 'ws_low', windUnit: 'mps', dir: 'wd_low' },
    { heightFt: 30, temp: 't_high_c', tempUnit: 'C', wind: 'ws_high', windUnit: 'mps', dir: 'wd_high' },
  ],
}, null, 2))
const result = ref<any>(null)
const error = ref('')

async function importCsv() {
  error.value = ''
  result.value = null
  try { result.value = await $fetch(`${api}/api/import/csv`, { method: 'POST', body: { csv: csv.value, mapping: JSON.parse(mapping.value) } }) }
  catch { error.value = 'Import failed. Check that the mapping is valid JSON and the column names match.' }
}
const example = computed(() => `curl -X POST ${api}/api/readings -H 'content-type: application/json' -d '{"source":"my-tower","blockId":"block-3","time":"${new Date().toISOString()}","levels":[{"heightFt":5,"tempF":54.1,"windMph":3.5,"windDirDeg":280},{"heightFt":30,"tempF":61,"windMph":5,"windDirDeg":265}]}'`)
</script>

<template>
  <main class="wide">
    <section class="card">
      <div class="label">Where the data comes from</div>
      <div class="tablewrap">
        <table>
          <thead><tr><th>Role</th><th>Adapter</th><th>Kind</th><th>Detail</th><th>Last update</th></tr></thead>
          <tbody>
            <tr v-for="(s, i) in snap?.sources ?? []" :key="i">
              <td>{{ s.role }}</td><td><code>{{ s.adapter }}</code></td><td>{{ s.kind }}</td><td>{{ s.detail }}</td>
              <td class="num">{{ s.lastMs ? fmtStamp(s.lastMs) : '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted">Every feed is converted to one common reading format, with heights carried in the data. A new sensor or network needs only a new adapter.</p>
    </section>

    <div class="grid2">
      <section class="card">
        <div class="label">Connect a tower: post a reading</div>
        <p class="muted">Any logger with two or more heights can post JSON. The block switches from the virtual tower to your readings.</p>
        <textarea :value="example" rows="6" readonly aria-label="Example request"></textarea>
      </section>

      <section class="card">
        <div class="label">Import a CSV</div>
        <textarea v-model="csv" rows="5" aria-label="CSV text"></textarea>
        <div class="label">Column mapping</div>
        <textarea v-model="mapping" rows="9" aria-label="Column mapping as JSON"></textarea>
        <button class="btn" @click="importCsv">Import and evaluate</button>
        <div v-if="error" class="error" role="alert">{{ error }}</div>
        <div v-if="result" style="margin-top:8px">
          Imported {{ result.imported }} readings:
          <span class="chip GO">GO {{ result.summary.GO }}</span>
          <span class="chip CAUTION">CAUTION {{ result.summary.CAUTION }}</span>
          <span class="chip STOP">STOP {{ result.summary.STOP }}</span>
          <div v-for="e in result.errors" :key="e" class="error">{{ e }}</div>
        </div>
      </section>
    </div>
  </main>
</template>
