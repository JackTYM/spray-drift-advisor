<script setup lang="ts">
export interface LabelReading {
  productName: string | null; epaRegNo: string | null; activeIngredients: string[]
  windMinMph: number | null; windMaxMph: number | null; inversionProhibited: boolean | null
  dropletSize: 'fine' | 'medium' | 'coarse' | null; bufferFt: number | null; volatility: 'low' | 'high' | null
  evidence: { field: string; quote: string }[]; notes: string
}
const emit = defineEmits<{ use: [label: LabelReading] }>()
const api = useRuntimeConfig().public.apiBase as string
const busy = ref(false)
const error = ref('')
const label = ref<LabelReading | null>(null)

const rows = computed(() => {
  const l = label.value
  if (!l) return []
  const quote = (...keys: string[]) => l.evidence.find(e => keys.some(k => e.field.toLowerCase().includes(k)))?.quote
  return [
    { name: 'Product', value: l.productName, quote: quote('product') },
    { name: 'Minimum wind', value: l.windMinMph === null ? null : `${l.windMinMph} mph`, quote: quote('windmin', 'minimum wind', 'wind min') },
    { name: 'Maximum wind', value: l.windMaxMph === null ? null : `${l.windMaxMph} mph`, quote: quote('windmax', 'maximum wind', 'wind max') },
    { name: 'Inversions', value: l.inversionProhibited === null ? null : l.inversionProhibited ? 'Do not apply during an inversion' : 'No prohibition found', quote: quote('inversion') },
    { name: 'Droplet size', value: l.dropletSize, quote: quote('droplet') },
    { name: 'Buffer', value: l.bufferFt === null ? null : `${l.bufferFt} ft (${Math.round(l.bufferFt * 0.3048)} m)`, quote: quote('buffer') },
    { name: 'Vapor drift', value: l.volatility === null ? null : l.volatility === 'high' ? 'Label warns of volatility' : 'No volatility warning', quote: quote('volatil') },
  ]
})

/** Phone photos are large; shrink them so the upload is quick and within the reader's limits. */
async function toBase64(file: File): Promise<{ data: string; mediaType: string }> {
  if (file.type === 'application/pdf') {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { data: btoa(s), mediaType: 'application/pdf' }
  }
  const img = await createImageBitmap(file)
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return { data: canvas.toDataURL('image/jpeg', 0.88).split(',')[1]!, mediaType: 'image/jpeg' }
}

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  busy.value = true; error.value = ''; label.value = null
  try {
    const r = await $fetch<{ label?: LabelReading; error?: string }>(`${api}/api/label`, { method: 'POST', body: await toBase64(file) })
    if (r.label) label.value = r.label
    else error.value = r.error ?? 'The label could not be read. Enter the limits by hand.'
  } catch (err: any) {
    error.value = err?.data?.error ?? 'The label could not be read. Enter the limits by hand.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="labelreader">
    <label class="btn secondary filebtn">
      {{ busy ? 'Reading the label…' : 'Read the product label' }}
      <input type="file" accept="image/*,application/pdf" capture="environment" :disabled="busy" @change="onFile">
    </label>
    <div v-if="error" class="error" role="alert">{{ error }}</div>
    <div v-if="label" class="labelresult">
      <div v-for="r in rows" :key="r.name" class="labelrow">
        <div class="label">{{ r.name }}</div>
        <div>{{ r.value ?? 'Not stated on the label' }}</div>
        <div v-if="r.quote" class="quote">“{{ r.quote }}”</div>
      </div>
      <div v-if="label.notes" class="muted">{{ label.notes }}</div>
      <p class="muted">Read by Claude. Check each line against the paper label before using it; the label is the legal authority.</p>
      <button class="btn" @click="emit('use', label!)">Use these limits</button>
    </div>
  </div>
</template>
