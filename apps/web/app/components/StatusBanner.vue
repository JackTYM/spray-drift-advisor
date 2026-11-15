<script setup lang="ts">
import type { Evaluation } from '@drift/engine'
const props = defineProps<{ evaluation: Evaluation | null }>()
const why = computed(() => {
  const e = props.evaluation
  if (!e) return 'Waiting for the first tower reading.'
  if (!e.triggers.length) return 'No inversion, and wind is within limits at both heights.'
  const order = { STOP: 2, CAUTION: 1, GO: 0 }
  return [...e.triggers].sort((a, b) => order[b.level] - order[a.level])[0].text
})
</script>

<template>
  <div class="banner" :class="evaluation?.status ?? 'CAUTION'" role="status" aria-live="assertive">
    <div class="big">{{ evaluation?.status ?? '...' }}</div>
    <div class="why">{{ why }}</div>
  </div>
</template>
