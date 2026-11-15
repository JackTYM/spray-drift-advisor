<script setup lang="ts">
const props = defineProps<{ field: { id: string; name: string; lat: number; lon: number }; jobMinutes: number }>()
const api = useRuntimeConfig().public.apiBase as string

const busy = ref(false)
const result = ref<{ sent: number; text: string; error?: string } | null>(null)
const failed = ref('')

async function send() {
  busy.value = true
  failed.value = ''
  try {
    result.value = await $fetch<{ sent: number; text: string; error?: string }>(`${api}/api/plan/text`, {
      method: 'POST',
      body: { ...props.field, jobMinutes: props.jobMinutes },
    })
  } catch (e: any) {
    result.value = null
    failed.value = e?.data?.error ?? 'Could not send the plan text.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="plantext">
    <button class="btn secondary" :disabled="busy" @click="send">{{ busy ? 'Sending…' : 'Text the team this plan' }}</button>
    <div role="status">
      <p v-if="result" class="muted">
        “{{ result.text }}”
        <template v-if="result.error"><span class="error">{{ result.error }}</span></template>
        <template v-else>Sent to {{ result.sent }} phone{{ result.sent === 1 ? '' : 's' }}.</template>
      </p>
      <p v-else-if="failed" class="error">{{ failed }}</p>
    </div>
  </div>
</template>

<style scoped>
.plantext .muted { margin: 8px 0 0; }
.plantext .error { display: block; }
</style>
