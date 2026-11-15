<script setup lang="ts">
import { PRODUCTS, type Job } from '@drift/engine'
import type { LabelReading } from '~/components/LabelReader.vue'

const props = defineProps<{ blockId: string }>()
const { snap, api } = useRanch()
const blockId = computed(() => props.blockId)
const block = computed(() => snap.value?.blocks.find(b => b.id === blockId.value) ?? null)
const ev = computed(() => block.value?.evaluation ?? null)
const bufferM = useBufferM()
const session = computed(() => snap.value?.sessions.find(s => s.blockId === blockId.value && s.phase !== 'closed') ?? null)

const job = reactive<Job>({ product: PRODUCTS[0].name, volatility: PRODUCTS[0].volatility, droplet: 'medium' })
watch(() => job.product, p => { job.volatility = products.value.find(x => x.name === p)?.volatility ?? job.volatility })
const labelMin = ref<number | null>(null)
const labelMax = ref<number | null>(null)
const overrideReason = ref('')
const holdReason = ref('')
/** Details for the spray record. The applicator's own details are remembered on this phone. */
const details = reactive({ applicatorName: '', licenseNo: '', epaRegNo: '', activeIngredient: '', ratePerAcre: '', targetPest: '', reiHours: null as number | null, sensitiveAreasChecked: false })
onMounted(() => {
  try { Object.assign(details, JSON.parse(localStorage.getItem('applicator') ?? '{}')) } catch { /* nothing saved */ }
})
watch(() => [details.applicatorName, details.licenseNo], () => {
  try { localStorage.setItem('applicator', JSON.stringify({ applicatorName: details.applicatorName, licenseNo: details.licenseNo })) } catch { /* storage unavailable */ }
})
const products = ref(PRODUCTS.map(p => ({ ...p })))
/** Fills the job form from a label the applicator has checked. */
function useLabel(l: LabelReading) {
  if (l.productName) {
    if (!products.value.some(p => p.name === l.productName)) products.value.push({ name: l.productName, volatility: l.volatility ?? 'low' })
    job.product = l.productName
  }
  if (l.volatility) job.volatility = l.volatility
  if (l.dropletSize) job.droplet = l.dropletSize
  if (l.windMinMph !== null) labelMin.value = l.windMinMph
  if (l.windMaxMph !== null) labelMax.value = l.windMaxMph
  if (l.bufferFt !== null) bufferM.value = Math.round(l.bufferFt * 0.3048)
  if (l.epaRegNo) details.epaRegNo = l.epaRegNo
  if (l.activeIngredients.length) details.activeIngredient = l.activeIngredients.join(', ')
}
const error = ref('')
const pushState = ref('')

async function call(path: string, body: object) {
  error.value = ''
  try {
    const r = await $fetch<{ error?: string }>(`${api}${path}`, { method: 'POST', body })
    if (r.error) error.value = r.error
    else overrideReason.value = ''
  } catch { error.value = 'Could not reach the server.' }
}
const jobBody = (): Job => ({
  ...job, labelMinWindMph: labelMin.value ?? undefined, labelMaxWindMph: labelMax.value ?? undefined,
  applicatorName: details.applicatorName || undefined, licenseNo: details.licenseNo || undefined, epaRegNo: details.epaRegNo || undefined,
  activeIngredient: details.activeIngredient || undefined, ratePerAcre: details.ratePerAcre || undefined, targetPest: details.targetPest || undefined,
  reiHours: details.reiHours ?? undefined, sensitiveAreasChecked: details.sensitiveAreasChecked,
})
const held = ref('')
async function holdOff() {
  await call('/api/sessions', { blockId: blockId.value, job: jobBody(), phase: 'not-sprayed', holdReason: holdReason.value || undefined })
  if (!error.value) { held.value = `Logged at ${snap.value ? fmtTime(snap.value.nowMs) : 'now'}: not spraying ${block.value?.name ?? ''}.`; holdReason.value = '' }
}
const create = (phase: 'waiting' | 'spraying') => call('/api/sessions', { blockId: blockId.value, job: jobBody(), phase, overrideReason: overrideReason.value || undefined })
const start = () => call(`/api/sessions/${session.value!.id}/start`, { overrideReason: overrideReason.value || undefined })
const finish = () => call(`/api/sessions/${session.value!.id}/finish`, {})

function beep() {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  osc.frequency.value = 880
  osc.connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + 0.6)
}
watch(() => ev.value?.status, (now, before) => {
  if (now === 'STOP' && before && before !== 'STOP' && session.value) { navigator.vibrate?.([300, 150, 300]); beep() }
})

async function enablePush() {
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    if ((await Notification.requestPermission()) !== 'granted') { pushState.value = 'Notifications were not allowed.'; return }
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: useRuntimeConfig().public.vapidPublicKey as string })
    await $fetch(`${api}/api/push/subscribe`, { method: 'POST', body: { role: 'applicator', subscription: sub.toJSON() } })
    pushState.value = 'Alerts are on for this device.'
  } catch { pushState.value = 'Could not turn on alerts. On iPhone, add this page to the home screen first.' }
}
</script>

<template>
  <div class="jobpanel">
      <template v-if="!session">
        <details class="more">
          <summary>Job: {{ job.product }}, {{ job.droplet }} droplets</summary>
          <LabelReader @use="useLabel" />
        <select v-model="job.product" aria-label="Product"><option v-for="p in products" :key="p.name">{{ p.name }}</option></select>
        <select v-model="job.droplet" aria-label="Droplet size">
          <option value="fine">Fine droplets</option><option value="medium">Medium droplets</option><option value="coarse">Coarse droplets</option>
        </select>
        <div class="row">
          <label>Label minimum wind, mph<input v-model.number="labelMin" type="number" placeholder="3"></label>
          <label>Label maximum wind, mph<input v-model.number="labelMax" type="number" placeholder="10"></label>
        </div>
        </details>
        <details class="more">
          <summary>Details for the spray record</summary>
          <div class="row">
            <label>Applicator<input v-model="details.applicatorName" autocomplete="name"></label>
            <label>License or certificate no.<input v-model="details.licenseNo"></label>
          </div>
          <div class="row">
            <label>EPA Reg. No.<input v-model="details.epaRegNo"></label>
            <label>Active ingredient<input v-model="details.activeIngredient"></label>
          </div>
          <div class="row">
            <label>Rate per acre<input v-model="details.ratePerAcre" placeholder="e.g. 12 fl oz"></label>
            <label>Target pest<input v-model="details.targetPest"></label>
          </div>
          <label>Re-entry interval, hours<input v-model.number="details.reiHours" type="number" min="0"></label>
          <label class="check"><input v-model="details.sensitiveAreasChecked" type="checkbox"> I checked downwind for schools, homes, workers, water and sensitive crops</label>
        </details>
        <label v-if="ev?.status === 'STOP'">Reason for spraying during a Stop (goes in the record)
          <input v-model="overrideReason">
        </label>
        <button class="btn" :disabled="!ev" @click="create('spraying')">Start spraying</button>
        <button v-if="ev && ev.status !== 'GO'" class="btn secondary" @click="create('waiting')">Alert me when it is safe</button>
        <details class="more" style="margin-top:12px">
          <summary>Not spraying this block now?</summary>
          <label>Reason, if you want one on the record
            <input v-model="holdReason" placeholder="e.g. inversion at dawn, waiting for the window">
          </label>
          <button class="btn secondary" style="margin:0 0 12px" :disabled="!ev" @click="holdOff">Log that I am not spraying</button>
        </details>
        <div v-if="held" class="muted" role="status">{{ held }} <NuxtLink to="/records">See the spray log</NuxtLink></div>
      </template>

      <template v-else>
        <h2>{{ session.phase === 'waiting' ? 'Waiting for a safe window' : session.phase === 'spraying' ? 'Spraying' : 'Post-spray watch' }}</h2>
        <div>{{ session.job.product }}, {{ session.job.droplet }} droplets, since {{ fmtTime(session.startedMs) }}</div>
        <div v-if="session.overrideReason" class="muted">Override reason: {{ session.overrideReason }}</div>
        <template v-if="session.phase === 'waiting'">
          <label v-if="ev?.status === 'STOP'" style="margin-top:10px">Reason for spraying during a Stop (goes in the record)
            <input v-model="overrideReason">
          </label>
          <button class="btn" @click="start">Start spraying</button>
          <button class="btn secondary" @click="finish">Cancel</button>
        </template>
        <button v-else-if="session.phase === 'spraying'" class="btn" @click="finish">Finish spraying</button>
        <div v-else class="muted" style="margin-top:8px">Still watching. You will be alerted if conditions turn.</div>
        <p><NuxtLink :to="`/record/${session.id}`">View the job record</NuxtLink></p>
      </template>
      <div v-if="error" class="error" role="alert">{{ error }}</div>
      <button class="linkbtn" @click="enablePush">Turn on alerts for this device</button>
      <div v-if="pushState" class="muted" role="status">{{ pushState }}</div>
  </div>
</template>
