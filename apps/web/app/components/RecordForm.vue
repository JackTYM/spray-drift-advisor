<script setup lang="ts">
import { BLOCKS, PRODUCTS } from '@drift/engine'

const emit = defineEmits<{ saved: []; cancel: [] }>()
const api = useRuntimeConfig().public.apiBase as string
const busy = ref(false)
const error = ref('')

/** Arizona does not change its clocks, so local time here is always seven hours behind UTC. */
const localNow = (offsetMin = 0) => new Date(Date.now() - 7 * 3_600_000 + offsetMin * 60_000).toISOString().slice(0, 16)
const toMs = (local: string) => (local ? Date.parse(`${local}:00-07:00`) : NaN)

const f = reactive({
  outcome: 'sprayed' as 'sprayed' | 'not-sprayed', blockId: 'block-3', started: localNow(-60), stopped: localNow(),
  product: PRODUCTS[0]!.name, droplet: 'medium' as 'fine' | 'medium' | 'coarse', volatility: 'low' as 'low' | 'high',
  applicatorName: '', licenseNo: '', epaRegNo: '', activeIngredient: '', ratePerAcre: '', targetPest: '', reiHours: null as number | null,
  sensitiveAreasChecked: false, holdReason: '',
})
onMounted(() => {
  try { Object.assign(f, JSON.parse(localStorage.getItem('applicator') ?? '{}')) } catch { /* nothing saved */ }
})

async function save() {
  busy.value = true; error.value = ''
  try {
    const r = await $fetch<{ error?: string }>(`${api}/api/spraylog`, { method: 'POST', body: {
      blockId: f.blockId, outcome: f.outcome, startedMs: toMs(f.started), finishedMs: f.outcome === 'sprayed' ? toMs(f.stopped) : undefined,
      holdReason: f.holdReason || undefined,
      job: {
        product: f.product, droplet: f.droplet, volatility: f.volatility,
        applicatorName: f.applicatorName || undefined, licenseNo: f.licenseNo || undefined, epaRegNo: f.epaRegNo || undefined,
        activeIngredient: f.activeIngredient || undefined, ratePerAcre: f.ratePerAcre || undefined, targetPest: f.targetPest || undefined,
        reiHours: f.reiHours ?? undefined, sensitiveAreasChecked: f.sensitiveAreasChecked,
      },
    } })
    if (r.error) error.value = r.error
    else emit('saved')
  } catch (err: any) {
    error.value = err?.data?.error ?? 'The record could not be saved.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="recordform" @submit.prevent="save">
    <div class="row">
      <label>What happened
        <select v-model="f.outcome"><option value="sprayed">Sprayed</option><option value="not-sprayed">Decided not to spray</option></select></label>
      <label>Block
        <select v-model="f.blockId"><option v-for="b in BLOCKS" :key="b.id" :value="b.id">{{ b.name }}, {{ b.note.toLowerCase() }}</option></select></label>
    </div>
    <div class="row">
      <label>{{ f.outcome === 'sprayed' ? 'Started' : 'When' }} (Arizona time)<input v-model="f.started" type="datetime-local" required></label>
      <label v-if="f.outcome === 'sprayed'">Stopped (Arizona time)<input v-model="f.stopped" type="datetime-local" required></label>
      <label v-else>Reason<input v-model="f.holdReason" placeholder="e.g. inversion at dawn"></label>
    </div>
    <div class="row">
      <label>Product<input v-model="f.product" required list="products"></label>
      <label>EPA Reg. No.<input v-model="f.epaRegNo"></label>
      <label>Active ingredient<input v-model="f.activeIngredient"></label>
    </div>
    <datalist id="products"><option v-for="p in PRODUCTS" :key="p.name" :value="p.name" /></datalist>
    <div class="row">
      <label>Applicator<input v-model="f.applicatorName" autocomplete="name"></label>
      <label>License or certificate no.<input v-model="f.licenseNo"></label>
      <label>Target pest<input v-model="f.targetPest"></label>
    </div>
    <div class="row">
      <label>Rate per acre<input v-model="f.ratePerAcre" placeholder="e.g. 12 fl oz"></label>
      <label>Droplet size
        <select v-model="f.droplet"><option value="fine">Fine</option><option value="medium">Medium</option><option value="coarse">Coarse</option></select></label>
      <label>Re-entry interval, hours<input v-model.number="f.reiHours" type="number" min="0"></label>
    </div>
    <label class="check"><input v-model="f.sensitiveAreasChecked" type="checkbox"> Downwind was checked for schools, homes, workers, water and sensitive crops</label>
    <p class="muted">The conditions at the start and stop are filled in from what the tower logged within ten minutes of those times. If the tower has no reading for then, the record is saved without them and marked as entered afterwards.</p>
    <div v-if="error" class="error" role="alert">{{ error }}</div>
    <div class="row" style="max-width:420px">
      <button class="btn" :disabled="busy">{{ busy ? 'Saving…' : 'Save record' }}</button>
      <button type="button" class="btn secondary" @click="emit('cancel')">Cancel</button>
    </div>
  </form>
</template>
