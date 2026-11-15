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
const manual = reactive({ blockId: 'block-3', lowTemp: 54, lowWind: 3.5, lowDir: 280, highTemp: 61, highWind: 5, highDir: 265 })
const manualMsg = ref('')
function preset(kind: 'inversion' | 'mixed') {
  Object.assign(manual, kind === 'inversion'
    ? { lowTemp: 54, lowWind: 3.5, lowDir: 280, highTemp: 61, highWind: 5, highDir: 265 }
    : { lowTemp: 62, lowWind: 5, lowDir: 200, highTemp: 61, highWind: 7, highDir: 200 })
}
async function sendManual() {
  manualMsg.value = ''
  try {
    await $fetch(`${api}/api/readings`, { method: 'POST', body: {
      source: 'manual-entry', kind: 'measured', blockId: manual.blockId, time: new Date().toISOString(),
      levels: [
        { heightFt: 5, tempF: manual.lowTemp, windMph: manual.lowWind, windDirDeg: manual.lowDir },
        { heightFt: 30, tempF: manual.highTemp, windMph: manual.highWind, windDirDeg: manual.highDir },
      ],
    } })
    manualMsg.value = 'Reading sent. The block uses it for 5 minutes, then returns to its feed.'
  } catch { manualMsg.value = 'The reading was rejected. Check the numbers. Manual entry needs Live mode.' }
}
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
      <h2>Where the data comes from</h2>
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

    <section class="card">
      <h2>Enter a reading by hand</h2>
      <p class="muted">For a handheld reading or a what-if check. Works in Live mode: the chosen block switches to your numbers for 5 minutes, and any open spray job on it is alerted if the status changes.</p>
      <div class="row">
        <select v-model="manual.blockId" aria-label="Block"><option value="block-1">Block 1</option><option value="block-2">Block 2</option><option value="block-3">Block 3</option></select>
        <button class="btn secondary" style="margin:0 0 8px" @click="preset('inversion')">Fill: inversion</button>
        <button class="btn secondary" style="margin:0 0 8px" @click="preset('mixed')">Fill: mixed air</button>
      </div>
      <div class="row">
        <label>5 ft temp °F<input v-model.number="manual.lowTemp" type="number" step="0.1"></label>
        <label>5 ft wind mph<input v-model.number="manual.lowWind" type="number" step="0.1"></label>
        <label>5 ft wind from °<input v-model.number="manual.lowDir" type="number"></label>
      </div>
      <div class="row">
        <label>30 ft temp °F<input v-model.number="manual.highTemp" type="number" step="0.1"></label>
        <label>30 ft wind mph<input v-model.number="manual.highWind" type="number" step="0.1"></label>
        <label>30 ft wind from °<input v-model.number="manual.highDir" type="number"></label>
      </div>
      <button class="btn" style="max-width:260px" @click="sendManual">Send reading</button>
      <div class="muted" role="status">{{ manualMsg }}</div>
    </section>

    <div class="grid2">
      <section class="card">
        <h2>Connect a tower</h2>
        <p class="muted">Any logger with two or more heights can post JSON. The block switches from the virtual tower to your readings.</p>
        <textarea :value="example" rows="6" readonly aria-label="Example request"></textarea>
      </section>

      <section class="card">
        <h2>Import a CSV</h2>
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
