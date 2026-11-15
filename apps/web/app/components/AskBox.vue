<script setup lang="ts">
const props = defineProps<{ context?: string; examples?: string[] }>()
const api = useRuntimeConfig().public.apiBase as string
const question = ref('')
const busy = ref(false)
const turns = ref<{ q: string; a: string; failed?: boolean }[]>([])
const examples = computed(() => props.examples ?? ['What would it cost me to spray now?', 'When is the best time to spray?', '¿Por qué no puedo fumigar?'])

async function send(text = question.value) {
  const q = text.trim()
  if (!q || busy.value) return
  busy.value = true
  question.value = ''
  try {
    const r = await $fetch<{ answer?: string; error?: string }>(`${api}/api/ask`, { method: 'POST', body: { question: q, context: props.context || undefined } })
    turns.value.push({ q, a: r.answer ?? r.error ?? 'No answer came back.', failed: !r.answer })
  } catch (err: any) {
    turns.value.push({ q, a: err?.data?.error ?? 'The assistant could not be reached. The status above is unaffected.', failed: true })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="ask">
    <div v-for="(t, i) in turns" :key="i" class="turn">
      <div class="q">{{ t.q }}</div>
      <div class="a" :class="{ failed: t.failed }">{{ t.a }}</div>
    </div>
    <div v-if="busy" class="muted" role="status">Checking the current readings…</div>
    <div v-if="!turns.length && !busy" class="examples">
      <button v-for="e in examples" :key="e" @click="send(e)">{{ e }}</button>
    </div>
    <form class="row" @submit.prevent="send()">
      <input v-model="question" placeholder="Ask in English or Spanish" aria-label="Ask a question about spray conditions" maxlength="600" style="margin:0">
      <button class="btn" style="flex:0 0 96px;margin:0" :disabled="busy || !question.trim()">Ask</button>
    </form>
    <p class="muted">Answers are written by Claude from the readings and rules on this screen. It explains the status; it does not decide it. You can also reply to an alert text with a question.</p>
  </div>
</template>
