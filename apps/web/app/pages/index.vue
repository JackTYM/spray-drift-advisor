<script setup lang="ts">
import { BLOCKS, PRODUCTS, type Job } from '@drift/engine'

const { snap, api } = useRanch()
const route = useRoute()
const blockId = ref(String(route.query.block ?? 'block-3'))
const block = computed(() => snap.value?.blocks.find(b => b.id === blockId.value) ?? null)
const ev = computed(() => block.value?.evaluation ?? null)
const surroundings = useSurroundings(blockId)
const facts = computed(() => downwindFacts(block.value, surroundings.value))
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
    <div class="blockpick">
      <select v-model="blockId" aria-label="Block">
        <option v-for="b in BLOCKS" :key="b.id" :value="b.id">{{ b.name }}, {{ b.note.toLowerCase() }}</option>
      </select>
    </div>

    <StatusBanner :evaluation="ev" :where="snap && block ? `${block.name} at ${fmtTime(snap.nowMs)}` : undefined" />

    <TowerScene :reading="block?.reading ?? null" :delta-f="ev?.deltaF ?? 0" :ri="ev?.ri ?? 0"
      :droplet="session?.job.droplet ?? job.droplet" :site="block?.sites[0] ?? null" />

    <section class="sect">
      <h2>Is the air mixing?</h2>
      <MixingGauge :ri="ev?.ri ?? 0" />
    </section>

    <section class="sect">
      <h2>Why</h2>
      <TriggerList :triggers="ev?.triggers ?? []" />
    </section>

    <section v-if="facts" class="sect">
      <h2>Downwind</h2>
      <template v-if="facts.calm">Wind at 5 ft is near calm, so drift has no clear direction.</template>
      <template v-else>
        Spray would be carried toward the <strong>{{ facts.dir }}</strong>.
        <strong>{{ facts.addresses.length }}</strong> {{ facts.addresses.length === 1 ? 'address' : 'addresses' }} within {{ BUFFER_M }} m that way<template v-if="facts.crop">, over land mapped as {{ facts.crop.toLowerCase() }}</template>.
      </template>
      <div class="muted" style="margin-top:6px">{{ BUFFER_M }} m is an example buffer. <NuxtLink to="/dashboard">See the map</NuxtLink></div>
    </section>

    <div class="pair sect" style="padding:0">
      <div>
        <div class="label">Ground station alone</div>
        <span class="chip" :class="ev?.groundOnly.status ?? 'CAUTION'">{{ ev?.groundOnly.status ?? 'WAIT' }}</span>
        <div v-if="snap?.ground" class="muted" style="margin-top:8px">
          {{ snap.ground.tempF }}°F, wind {{ snap.ground.windMph }} mph from the {{ compass(snap.ground.windDirDeg) }}. It cannot see the air above it.
        </div>
      </div>
      <div>
        <div class="label">Next safe window</div>
        <div v-if="ev?.status === 'GO'" class="figure">Open now</div>
        <div v-else-if="block?.window" class="figure">{{ fmtTime(block.window.startMs) }}</div>
        <div v-else class="figure">None in 36 h</div>
        <div v-if="ev?.status !== 'GO' && block?.window" class="muted" style="margin-top:4px">until {{ fmtTime(block.window.endMs) }}. You will be alerted when it opens.</div>
      </div>
    </div>

    <section class="sect">
      <template v-if="!session">
        <h2>Spray job</h2>
        <select v-model="job.product" aria-label="Product"><option v-for="p in PRODUCTS" :key="p.name">{{ p.name }}</option></select>
        <select v-model="job.droplet" aria-label="Droplet size">
          <option value="fine">Fine droplets</option><option value="medium">Medium droplets</option><option value="coarse">Coarse droplets</option>
        </select>
        <div class="row">
          <label>Label minimum wind, mph<input v-model.number="labelMin" type="number" placeholder="3"></label>
          <label>Label maximum wind, mph<input v-model.number="labelMax" type="number" placeholder="10"></label>
        </div>
        <label v-if="ev?.status === 'STOP'">Reason for spraying during a Stop (goes in the record)
          <input v-model="overrideReason">
        </label>
        <button class="btn" :disabled="!ev" @click="create('spraying')">Start spraying</button>
        <button v-if="ev && ev.status !== 'GO'" class="btn secondary" @click="create('waiting')">Alert me when it is safe</button>
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
    </section>

    <div class="pad">
      <button class="btn secondary" @click="enablePush">Turn on alerts for this phone</button>
      <div class="muted" role="status">{{ pushState }}</div>
    </div>
  </main>
</template>
