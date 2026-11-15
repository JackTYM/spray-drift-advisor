<script setup lang="ts">
import { APPLICATION_METHODS, type ApplicationMethod } from '@drift/engine'

const props = defineProps<{ fieldId: string }>()
const { jobFor, setJob, minutesFor } = usePlans()
const job = computed(() => jobFor(props.fieldId))
const minutes = computed(() => minutesFor(props.fieldId))

function pickMethod(e: Event) {
  const m = APPLICATION_METHODS.find(x => x.id === (e.target as HTMLSelectElement).value) as ApplicationMethod
  setJob(props.fieldId, { method: m.id, acresPerHour: m.acresPerHour, setupMinutes: m.setupMinutes })
}
function num(e: Event, key: 'acres' | 'acresPerHour' | 'setupMinutes') {
  const v = Number((e.target as HTMLInputElement).value)
  if (Number.isFinite(v) && v >= 0) setJob(props.fieldId, { [key]: v })
}
</script>

<template>
  <div class="job-inputs">
    <label>How you apply
      <select :value="job.method" @change="pickMethod">
        <option v-for="m in APPLICATION_METHODS" :key="m.id" :value="m.id">{{ m.label }}</option>
      </select>
    </label>
    <div class="row">
      <label>Acres
        <input type="number" min="1" step="1" inputmode="decimal" :value="job.acres" @change="num($event, 'acres')">
      </label>
      <label>Acres per hour
        <input type="number" min="1" step="1" inputmode="decimal" :value="job.acresPerHour" @change="num($event, 'acresPerHour')">
      </label>
    </div>
    <div class="row">
      <label>Setup minutes
        <input type="number" min="0" step="5" inputmode="numeric" :value="job.setupMinutes" @change="num($event, 'setupMinutes')">
      </label>
      <p class="result">Job length: <strong>{{ minutes }} minutes</strong></p>
    </div>
    <p class="muted">Rates are examples. Use your own.</p>
  </div>
</template>

<style scoped>
.job-inputs input, .job-inputs select { min-height: 42px; }
.result { margin: 0; align-self: end; min-height: 42px; display: flex; align-items: center; }
</style>
