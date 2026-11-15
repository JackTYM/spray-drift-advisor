<script setup lang="ts">
import type { Trigger } from '@drift/engine'
defineProps<{ triggers: Trigger[] }>()
</script>

<template>
  <div>
    <div v-if="!triggers.length" class="trigger plain">Nothing is triggering. No inversion, and wind is within limits.</div>
    <div v-for="(t, i) in triggers" :key="i" class="trigger">
      <span class="chip" :class="t.level">{{ t.level }}</span>
      <span>{{ t.text }}</span>
    </div>
  </div>
</template>
