<script setup lang="ts">
import type { Trigger } from '@drift/engine'
defineProps<{ triggers: Trigger[] }>()
</script>

<template>
  <div>
    <div v-if="!triggers.length" class="muted">Nothing triggered.</div>
    <div v-for="(t, i) in triggers" :key="i" class="trigger">
      <span class="chip" :class="t.level">{{ t.level }}</span> {{ t.text }}
    </div>
  </div>
</template>
