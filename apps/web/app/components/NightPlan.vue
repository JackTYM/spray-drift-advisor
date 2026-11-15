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
  if (!r.done) return `None of the ${n} ${n === 1 ? 'job has' : 'jobs have'} a window in the next 48 hours.`
  let s = `${r.done} of ${n} ${n === 1 ? 'job fits' : 'jobs fit'} a window in the next 48 hours, finishing ${fmtWhen(r.finishMs!, props.nowMs)}${r.driveMinutes >= 1 ? `, with ${mins(r.driveMinutes)} of driving` : ''}.`
  const l = r.listOrder
  if (l.done < r.done) {
    s += ` Visiting them in list order would only get ${l.done} done.`
  } else if (l.finishMs !== null && l.finishMs - r.finishMs! >= 60_000) {
    s += ` Visiting them in list order would finish ${mins((l.finishMs - r.finishMs!) / 60_000)} later.`
  } else {
    if (r.done > 1) s += ' The order makes no difference.'
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
  <div class="nightplan">
    <p v-if="!fields.length" class="muted">Add fields to plan a route</p>
    <template v-else>
      <div class="pick">
        <span class="muted">Fields to plan:</span>
        <label v-for="f in fields" :key="f.id">
          <input type="checkbox" :checked="!skipped.includes(f.id)" @change="toggle(f.id, ($event.target as HTMLInputElement).checked)">
          {{ f.name }}
        </label>
      </div>
      <p class="mapfact">{{ summary }}</p>
      <div v-if="route.stops.length" class="tablewrap">
        <table>
          <thead>
            <tr><th>#</th><th>Field</th><th>Drive</th><th>Arrive</th><th>Start</th><th>Finish</th><th>Confidence</th></tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in route.stops" :key="s.id">
              <td>{{ i + 1 }}</td>
              <td><button class="linkbtn" type="button" @click="emit('select', s.id)">{{ s.name }}</button></td>
              <td class="num">{{ s.travelMinutes ? mins(s.travelMinutes) : 'none' }}</td>
              <td class="num">{{ fmtWhen(s.arriveMs, nowMs) }}</td>
              <td class="num">{{ fmtWhen(s.startMs, nowMs) }}<span v-if="s.waitMinutes >= 1" class="muted"> (wait {{ mins(s.waitMinutes) }})</span></td>
              <td class="num">{{ fmtWhen(s.finishMs, nowMs) }}</td>
              <td class="num">{{ pct(s.confidence) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="route.deferred.length" class="putoff">
        <span class="muted">Put off: </span>
        <template v-for="(d, i) in route.deferred" :key="d.id">
          <button class="linkbtn" type="button" @click="emit('select', d.id)">{{ d.name }}</button><span class="muted"> ({{ d.reason.toLowerCase() }}){{ i < route.deferred.length - 1 ? ', ' : '.' }}</span>
        </template>
      </p>
      <p v-if="included.length" class="muted">Expected cost: about ${{ route.costUsd.toLocaleString() }}: <template v-if="route.driveMiles >= 0.5">{{ route.driveMiles }} miles of driving, </template>the chance each job cannot finish, and rescheduling the fields put off.</p>
      <details class="more">
        <summary>Assumptions</summary>
        <div class="costs">
          <label>Road speed (mph) <input v-model.number="speed" type="number" min="5" max="75" step="5"></label>
          <label>Crew per hour ($) <input v-model.number="crewPerHour" type="number" min="0" step="10"></label>
          <label>Fuel per mile ($) <input v-model.number="fuelPerMile" type="number" min="0" step="0.1"></label>
          <label>Wasted trip ($) <input v-model.number="wastedTrip" type="number" min="0" step="50"></label>
        </div>
        <p class="muted">These figures are examples; change them to match your own. Drive times use the straight-line distance times 1.3 to allow for roads. The crew starts at the first field, and sets out later instead of waiting more than two hours.</p>
      </details>
    </template>
  </div>
</template>

<style scoped>
.pick { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; margin-bottom: 12px; }
.pick label { display: flex; align-items: center; gap: 7px; font-size: 15px; color: var(--ink); }
.pick input { width: 18px; height: 18px; min-height: 0; margin: 0; padding: 0; flex: none; accent-color: var(--warm); }
.mapfact { margin: 0 0 12px; }
.putoff { margin: 12px 0 6px; }
.putoff .linkbtn { margin: 0; }
td .linkbtn { margin: 0; text-align: left; }
details.more { margin-top: 12px; }
.costs { display: flex; flex-wrap: wrap; gap: 10px 18px; margin-bottom: 10px; }
.costs label { display: flex; align-items: center; gap: 8px; }
.costs input { width: 84px; min-height: 40px; margin: 0; padding: 6px 10px; text-align: right; }
</style>
