<script setup lang="ts">
const props = defineProps<{ ri: number }>()
const left = computed(() => {
  const ri = props.ri
  if (ri <= 0) return 20
  if (ri < 0.25) return 40 + (ri / 0.25) * 20
  return Math.min(60 + Math.log10(ri / 0.25) * 30, 97)
})
const text = computed(() =>
  props.ri > 0.25 ? 'Mixing has shut down. Spray stays where it is released and travels as a layer.'
  : props.ri > 0 ? 'Mixing is fading. The wind is still stirring the air, but only just.'
  : 'The air is mixing freely. Spray disperses upward.')
</script>

<template>
  <div>
    <div class="gauge" role="img" :aria-label="`Mixing gauge. Richardson number ${ri}. ${text}`">
      <div style="width:40%;background:var(--go)"></div>
      <div style="width:20%;background:var(--caution)"></div>
      <div style="width:40%;background:var(--stop)"></div>
      <span class="needle" :style="{ left: left + '%' }"></span>
    </div>
    <div><strong>Ri {{ ri.toFixed(2) }}</strong> <span class="muted">(turbulence stops above 0.25)</span></div>
    <div class="muted">{{ text }}</div>
  </div>
</template>
