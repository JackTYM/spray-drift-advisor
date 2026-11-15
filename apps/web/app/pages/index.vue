<script setup lang="ts">
import { BLOCKS, PRODUCTS, type Job } from '@drift/engine'

const { snap, api } = useRanch()
const route = useRoute()
const blockId = ref(String(route.query.block ?? 'block-3'))
const block = computed(() => snap.value?.blocks.find(b => b.id === blockId.value) ?? null)
const ev = computed(() => block.value?.evaluation ?? null)
const session = computed(() => snap.value?.sessions.find(s => s.blockId === blockId.value && s.phase !== 'closed') ?? null)

const job = reactive<Job>({ product: PRODUCTS[0].name, volatility: PRODUCTS[0].volatility, droplet: 'medium' })
watch(() => job.product, p => { job.volatility = PRODUCTS.find(x => x.name === p)?.volatility ?? 'low' })
const labelMin = ref<number | null>(null)
const labelMax = ref<number | null>(null)
const overrideReason = ref('')
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
const jobBody = (): Job => ({ ...job, labelMinWindMph: labelMin.value ?? undefined, labelMaxWindMph: labelMax.value ?? undefined })
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
  <main class="phone">
    <div class="pad">
      <select v-model="blockId" aria-label="Block">
        <option v-for="b in BLOCKS" :key="b.id" :value="b.id">{{ b.name }} · {{ b.crop }} · {{ b.note }}</option>
      </select>
    </div>

    <StatusBanner :evaluation="ev" />

    <div class="pad">
      <div class="card" style="padding:8px">
        <TowerScene :reading="block?.reading ?? null" :delta-f="ev?.deltaF ?? 0" :ri="ev?.ri ?? 0" :droplet="session?.job.droplet ?? job.droplet" />
      </div>

      <div class="card">
        <div class="label">Is the air mixing?</div>
        <MixingGauge :ri="ev?.ri ?? 0" />
      </div>

      <div class="card">
        <div class="label">What triggered this</div>
        <TriggerList :triggers="ev?.triggers ?? []" />
      </div>

      <div class="card">
        <div class="label">Ground station alone ({{ snap?.ground?.station ?? 'none' }})</div>
        <span class="chip" :class="ev?.groundOnly.status ?? 'CAUTION'">{{ ev?.groundOnly.status ?? '...' }}</span>
        <span v-if="snap?.ground" class="muted"> {{ snap.ground.tempF }}°F, wind {{ snap.ground.windMph }} mph from {{ compass(snap.ground.windDirDeg) }}. It cannot see the air above it.</span>
      </div>

      <div class="card">
        <div class="label">Next safe window</div>
        <template v-if="ev?.status === 'GO'"><strong>Open now</strong></template>
        <template v-else-if="block?.window"><strong>{{ fmtTime(block.window.startMs) }} to {{ fmtTime(block.window.endMs) }}</strong></template>
        <template v-else><strong>None in the next 36 hours</strong></template>
        <div class="muted">As of {{ snap ? fmtStamp(snap.nowMs) : '...' }}</div>
      </div>

      <div class="card">
        <template v-if="!session">
          <div class="label">Spray job</div>
          <select v-model="job.product" aria-label="Product"><option v-for="p in PRODUCTS" :key="p.name">{{ p.name }}</option></select>
          <select v-model="job.droplet" aria-label="Droplet size">
            <option value="fine">Fine droplets</option><option value="medium">Medium droplets</option><option value="coarse">Coarse droplets</option>
          </select>
          <div class="row">
            <input v-model.number="labelMin" type="number" placeholder="Label min wind (mph)" aria-label="Label minimum wind in mph">
            <input v-model.number="labelMax" type="number" placeholder="Label max wind (mph)" aria-label="Label maximum wind in mph">
          </div>
          <input v-if="ev?.status === 'STOP'" v-model="overrideReason" placeholder="Reason to override STOP (logged)" aria-label="Override reason">
          <button class="btn" :disabled="!ev" @click="create('spraying')">Start spraying</button>
          <button v-if="ev && ev.status !== 'GO'" class="btn secondary" @click="create('waiting')">Tell me when it is safe</button>
        </template>

        <template v-else>
          <div class="label">Session: {{ session.phase }}</div>
          <div>{{ session.job.product }} · {{ session.job.droplet }} droplets · since {{ fmtTime(session.startedMs) }}</div>
          <div v-if="session.overrideReason" class="muted">Override reason: {{ session.overrideReason }}</div>
          <template v-if="session.phase === 'waiting'">
            <input v-if="ev?.status === 'STOP'" v-model="overrideReason" placeholder="Reason to override STOP (logged)" aria-label="Override reason">
            <button class="btn" @click="start">Start spraying</button>
            <button class="btn secondary" @click="finish">Cancel</button>
          </template>
          <button v-else-if="session.phase === 'spraying'" class="btn" @click="finish">Finish spraying</button>
          <div v-else class="muted">Post-spray watch is running. You will be alerted if conditions turn.</div>
          <NuxtLink :to="`/record/${session.id}`" class="muted">View job record</NuxtLink>
        </template>
        <div v-if="error" class="error" role="alert">{{ error }}</div>
      </div>

      <button class="btn secondary" @click="enablePush">Turn on alerts for this device</button>
      <div class="muted">{{ pushState }}</div>
    </div>
  </main>
</template>
