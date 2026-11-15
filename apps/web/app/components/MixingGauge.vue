<script setup lang="ts">
const props = defineProps<{ ri: number }>()
const zone = computed(() => (props.ri > 0.25 ? 2 : props.ri > 0 ? 1 : 0))
const left = computed(() => {
  const ri = props.ri
  if (ri <= 0) return 20
  if (ri < 0.25) return 40 + (ri / 0.25) * 20
  return Math.min(60 + Math.log10(ri / 0.25) * 30, 97)
})
const text = computed(() => [
  'The air is mixing freely. Spray disperses upward.',
  'Mixing is fading. The wind is still stirring the air, but only just.',
  'Mixing has shut down. Spray stays where it is released and travels as a layer.',
][zone.value])
</script>

<template>
  <div>
    <div class="gauge" role="img" :aria-label="`Mixing gauge. Richardson number ${ri.toFixed(2)}. ${text}`">
      <div :class="{ on: zone === 0 }" style="width:40%;background:var(--go)"></div>
      <div :class="{ on: zone === 1 }" style="width:20%;background:var(--caution)"></div>
      <div :class="{ on: zone === 2 }" style="width:40%;background:var(--stop)"></div>
      <span class="needle" :style="{ left: left + '%' }"></span>
    </div>
    <div class="gauge-scale" aria-hidden="true">
      <span style="width:40%">mixing</span><span style="width:20%">fading</span><span style="width:40%">trapped</span>
    </div>
    <div><span class="gauge-read">Ri {{ ri.toFixed(2) }}</span> <span class="muted">turbulence stops above 0.25</span></div>
    <div style="margin-top:4px">{{ text }}</div>
  </div>
</template>
