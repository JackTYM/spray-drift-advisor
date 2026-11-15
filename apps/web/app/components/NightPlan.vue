<script setup lang="ts">
import { planRoute, type RouteField } from '@drift/engine'

const props = defineProps<{ fields: RouteField[]; nowMs: number }>()
const emit = defineEmits<{ select: [id: string] }>()

const speed = ref(35)
const route = computed(() => planRoute(props.fields, { nowMs: props.nowMs, speedMph: speed.value }))

const mins = (m: number) => {
  const r = Math.round(m)
  if (r < 60) return `${r} min`
  const h = Math.floor(r / 60)
  const rest = r % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}
const pct = (c: number) => `${Math.round(c * 100)}%`

const summary = computed(() => {
  const r = route.value
  const n = props.fields.length
  if (!r.done) return `None of the ${n} ${n === 1 ? 'job' : 'jobs'} fit tonight.`
  let s = `${r.done} of ${n} ${n === 1 ? 'job fits' : 'jobs fit'} tonight, finishing ${fmtWhen(r.finishMs!, props.nowMs)}, with ${mins(r.driveMinutes)} of driving.`
  const l = r.listOrder
  if (l.done < r.done) {
    s += ` Visiting them in list order would only get ${l.done} done.`
  } else if (l.finishMs !== null && l.finishMs - r.finishMs! >= 60_000) {
    s += ` Visiting them in list order would finish ${mins((l.finishMs - r.finishMs!) / 60_000)} later.`
  } else {
    s += ' The order makes no difference.'
  }
  return s
})
</script>

<template>
  <section class="card nightplan">
    <h2>Tonight's route</h2>
    <p v-if="!fields.length" class="muted">Add fields to plan a route</p>
    <template v-else>
      <p class="figure">{{ summary }}</p>
      <div v-if="route.stops.length" class="tablewrap">
        <table>
          <thead>
            <tr><th>#</th><th>Field</th><th>Drive</th><th>Arrive</th><th>Start</th><th>Finish</th><th>Confidence</th></tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in route.stops" :key="s.id">
              <td>{{ i + 1 }}</td>
              <td><button class="linkbtn" type="button" @click="emit('select', s.id)">{{ s.name }}</button></td>
              <td>{{ s.travelMinutes ? mins(s.travelMinutes) : 'none' }}</td>
              <td>{{ fmtWhen(s.arriveMs, nowMs) }}</td>
              <td>{{ fmtWhen(s.startMs, nowMs) }}<span v-if="s.waitMinutes >= 1" class="muted"> (wait {{ mins(s.waitMinutes) }})</span></td>
              <td>{{ fmtWhen(s.finishMs, nowMs) }}</td>
              <td>{{ pct(s.confidence) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="route.deferred.length" class="putoff">
        <h3>Put off</h3>
        <ul>
          <li v-for="d in route.deferred" :key="d.id">
            <button class="linkbtn" type="button" @click="emit('select', d.id)">{{ d.name }}</button>
            <span class="muted">: {{ d.reason }}</span>
          </li>
        </ul>
      </div>
      <label class="speed">
        Average road speed (mph)
        <input v-model.number="speed" type="number" min="5" max="75" step="5">
      </label>
      <p class="muted">Drive times use the straight-line distance times 1.3 to allow for roads. The crew starts at the first field.</p>
    </template>
  </section>
</template>

<style scoped>
.putoff { margin-top: 14px; }
.putoff h3 { margin: 0 0 6px; }
.putoff ul { margin: 0; padding-left: 18px; }
.putoff .linkbtn { margin: 0; }
.speed { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
.speed input { width: 88px; min-height: 42px; margin: 0; padding: 6px 10px; text-align: right; }
</style>
