<script setup lang="ts">
import { planRoute, type RouteField } from '@drift/engine'

const props = defineProps<{ fields: RouteField[]; nowMs: number }>()
const emit = defineEmits<{ select: [id: string] }>()

const speed = ref(35)
const crewPerHour = ref(250)
const fuelPerMile = ref(0.6)
const wastedTrip = ref(400)
const skipped = ref<string[]>([])
const included = computed(() => props.fields.filter((f) => !skipped.value.includes(f.id)))
const toggle = (id: string, on: boolean) => {
  skipped.value = on ? skipped.value.filter((x) => x !== id) : [...skipped.value, id]
}
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)
const route = computed(() =>
  planRoute(included.value, {
    nowMs: props.nowMs,
    speedMph: speed.value,
    costs: { crewPerHourUsd: num(crewPerHour.value, 250), fuelPerMileUsd: num(fuelPerMile.value, 0.6), wastedTripUsd: num(wastedTrip.value, 400) },
  }),
)

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
  const n = included.value.length
  if (!n) return 'No fields are ticked, so there is nothing to plan.'
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
  const dollars = l.costUsd - r.costUsd
  if (dollars >= 1) {
    const miles = Math.round(l.driveMiles - r.driveMiles)
    s += ` That order saves about $${dollars}${miles >= 1 ? ` and ${miles} ${miles === 1 ? 'mile' : 'miles'}` : ''} against visiting them in list order.`
  }
  return s
})
</script>

<template>
  <section class="card nightplan">
    <h2>Tonight's route</h2>
    <p v-if="!fields.length" class="muted">Add fields to plan a route</p>
    <template v-else>
      <div class="pick">
        <label v-for="f in fields" :key="f.id">
          <input type="checkbox" :checked="!skipped.includes(f.id)" @change="toggle(f.id, ($event.target as HTMLInputElement).checked)">
          {{ f.name }}
        </label>
      </div>
      <p class="figure">{{ summary }}</p>
      <p v-if="included.length" class="figure">Expected cost of the night: about ${{ route.costUsd }}, with {{ route.driveMiles }} miles of driving.</p>
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
      <div class="costs">
        <label>Crew per hour ($) <input v-model.number="crewPerHour" type="number" min="0" step="10"></label>
        <label>Fuel per mile ($) <input v-model.number="fuelPerMile" type="number" min="0" step="0.1"></label>
        <label>Cost of a wasted trip ($) <input v-model.number="wastedTrip" type="number" min="0" step="50"></label>
      </div>
      <p class="muted">These cost figures are examples. Change them to match your own.</p>
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
.pick { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-bottom: 10px; }
.pick label { display: flex; align-items: center; gap: 6px; }
.costs { display: flex; flex-wrap: wrap; gap: 10px 18px; margin-top: 12px; }
.costs label { display: flex; align-items: center; gap: 8px; }
.costs input { width: 88px; min-height: 42px; margin: 0; padding: 6px 10px; text-align: right; }
.speed input { width: 88px; min-height: 42px; margin: 0; padding: 6px 10px; text-align: right; }
</style>
