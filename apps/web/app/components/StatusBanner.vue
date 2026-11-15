<script setup lang="ts">
import type { Evaluation } from '@drift/engine'

const props = defineProps<{ evaluation: Evaluation | null; where?: string }>()
const why = computed(() => {
  const e = props.evaluation
  if (!e) return 'Waiting for the first tower reading.'
  if (!e.triggers.length) return 'No inversion, and wind is within limits at both heights.'
  const order = { STOP: 2, CAUTION: 1, GO: 0 }
  return [...e.triggers].sort((a, b) => order[b.level] - order[a.level])[0]!.text
})

// Replay the wipe each time the status changes, but not on first paint.
const changed = ref(false)
watch(() => props.evaluation?.status, (now, before) => {
  if (!now || !before || now === before) return
  changed.value = false
  requestAnimationFrame(() => { changed.value = true })
})
</script>

<template>
  <div class="banner" :class="[evaluation?.status ?? 'wait', { changed }]" role="status" aria-live="assertive">
    <div v-if="where" class="where">{{ where }}</div>
    <div class="big">{{ evaluation?.status ?? 'Wait' }}</div>
    <div class="why">{{ why }}</div>
  </div>
</template>
