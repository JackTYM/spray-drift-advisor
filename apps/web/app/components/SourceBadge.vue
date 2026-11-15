<script setup lang="ts">
const props = defineProps<{ kind: 'measured' | 'estimated' | 'modelled'; detail?: string }>()
const WORDS = {
  measured: 'Measured: read by an instrument.',
  estimated: 'Estimated: worked out for this field from stations, the forecast and terrain.',
  modelled: 'Modelled: from the weather forecast model alone.',
} as const
const title = computed(() => WORDS[props.kind])
</script>

<template>
  <span class="srcbadge" :title="title">
    <span class="pill" :class="kind">{{ kind }}</span><span v-if="detail" class="detail">{{ detail }}</span>
  </span>
</template>

<style scoped>
.srcbadge { display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; }
.pill { font-size: 10px; line-height: 1; letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 6px; border: 1px solid currentColor; border-radius: 999px; white-space: nowrap; }
.pill.measured { color: var(--go); }
.pill.estimated { color: var(--cold); }
.pill.modelled { color: var(--muted); }
.detail { font-size: 12px; color: var(--muted); }
</style>
