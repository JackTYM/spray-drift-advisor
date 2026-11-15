<script setup lang="ts">
import { BLOCKS, planRoute, breakTime, confidenceWord, evaluate, squareOutline, toLngLat, towerModelFor, type BlockSnapshot, type RouteField, type Status, type Surroundings } from '@drift/engine'

const { example, setExample, bestChance, jobFor, fields, plans, errors, minutesFor, windowsFor, addField, removeField, PRESET_FIELDS } = usePlans()
/** Windows start on 15 minute steps, so one that starts within a step of now is open. */
const OPEN_SLACK_MS = 15 * 60_000
const fieldId = ref('block-3')
const field = computed(() => fields.value.find(f => f.id === fieldId.value) ?? fields.value[0]!)
const plan = computed(() => plans.value[field.value.id] ?? null)
const windows = computed(() => windowsFor(field.value.id))
const minutes = computed(() => minutesFor(field.value.id))
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval>
onMounted(() => { clock = setInterval(() => { now.value = Date.now() }, 30_000) })
onBeforeUnmount(() => clearInterval(clock))

/** The next window for a field, in a few characters and in full. */
function outlook(id: string) {
  const p = plans.value[id]
  if (!p) return { state: errors.value[id] ? 'NO DATA' : '…', status: undefined as Status | undefined, startMs: Infinity }
  const w = windowsFor(id)[0]
  if (!w) {
    const b = bestChance(id)
    return b ? { state: `${fmtDay(b.startMs)} ${fmtHour(b.startMs)} · ${Math.round(b.confidence * 100)}%`.toUpperCase(), status: undefined as Status | undefined, startMs: b.startMs + 1e12 } : { state: 'NONE', status: 'STOP' as Status, startMs: Infinity }
  }
  const open = w.startMs <= now.value + OPEN_SLACK_MS
  return { state: open ? 'OPEN' : `${fmtDay(w.startMs)} ${fmtHour(w.startMs)}`.toUpperCase(), status: (open ? 'GO' : 'CAUTION') as Status, startMs: open ? 0 : w.startMs }
}
/** Fields in the order a crew could get to them: soonest window first. */
const ordered = computed(() => fields.value.map(f => ({ f, o: outlook(f.id) })).sort((a, b) => a.o.startMs - b.o.startMs))
const next = computed(() => windows.value[0] ?? null)
const openNow = computed(() => !!next.value && next.value.startMs <= now.value + OPEN_SLACK_MS)
/** The window as the plain-language answers should read it: an open window has already started. */
const answerWindow = computed(() => (next.value ? { ...next.value, startMs: openNow.value ? Math.min(next.value.startMs, now.value) : next.value.startMs } : null))
const tripCostUsd = ref(400)
/** When the inversion is expected to clear, with the spread across the ensemble. */
const clears = computed(() => (plan.value ? breakTime(plan.value.hours) : null))
const routeFields = computed<RouteField[]>(() => fields.value.filter(f => plans.value[f.id]).map(f => ({ id: f.id, name: f.name, lat: f.lat, lon: f.lon, jobMinutes: minutesFor(f.id), windows: windowsFor(f.id) })))
const presets = computed(() => PRESET_FIELDS.filter(p => !fields.value.some(f => f.name === p.name)))
function addPreset(p: { name: string; lat: number; lon: number }) { fieldId.value = addField(p.lat, p.lon, p.name).id }
const chance = computed(() => (next.value ? null : bestChance(field.value.id)))
const pct = (c: number) => `${Math.round(c * 100)}%`

/** The hour being previewed: the one clicked, or the start of the next window, or now. */
const picked = ref<number | null>(null)
watch(fieldId, () => { picked.value = null })
const hour = computed(() => {
  const hs = plan.value?.hours ?? []
  return hs.find(h => h.timeMs === picked.value) ?? hs.find(h => h.timeMs === (next.value?.startMs ?? chance.value?.startMs)) ?? hs[0] ?? null
})
const hourEval = computed(() => (hour.value ? evaluate({ history: [hour.value.reading], nowMs: hour.value.timeMs, sites: plan.value?.sites ?? [] }) : null))
const hourStatuses = computed(() => Object.fromEntries(fields.value.map(f => [f.id, plans.value[f.id]?.hours.find(h => h.timeMs === hour.value?.timeMs)?.status])))

const stage = ref<'map' | '3d'>('map')
const isBlock = computed(() => BLOCKS.some(b => b.id === field.value.id))
/** The ranch's blocks as the 3D scene expects them, each showing its estimate for the previewed hour. */
/** Every field as the 3D scene draws it. A field added by hand has no traced boundary, so it is drawn as a square of its acreage. */
const sceneModels = computed(() => fields.value.map(f => {
  const block = BLOCKS.find(b => b.id === f.id)
  if (block) return { id: f.id, lat: block.lat, lon: block.lon, outline: block.outline }
  const half = Math.sqrt(jobFor(f.id).acres * 4046.86) / 2
  return { id: f.id, lat: f.lat, lon: f.lon, outline: squareOutline(half).map(p => toLngLat(f.lat, f.lon, p.x, p.y)) }
}))
/** Each field showing its estimate for the previewed hour. */
const sceneBlocks = computed<BlockSnapshot[]>(() => fields.value.map(f => {
  const b = BLOCKS.find(x => x.id === f.id)
  const p = plans.value[f.id]
  const h = p?.hours.find(x => x.timeMs === hour.value?.timeMs) ?? null
  const sites = p?.sites ?? b?.sites ?? []
  return { id: f.id, name: f.name, crop: b?.crop ?? '', note: b?.note ?? '', reading: h?.reading ?? null, window: null, sites, evaluation: h ? { ...evaluate({ history: [h.reading], nowMs: h.timeMs, sites }), status: h.status } : null }
}))
const blockSurroundings = useSurroundings(computed(() => (isBlock.value ? field.value.id : 'block-3')))
/** Addresses and neighbouring crops are only known around the ranch; elsewhere the scene is drawn without them. */
const noSurroundings = computed<Surroundings>(() => ({ blockId: field.value.id, addresses: [], centerCrop: null, crops: [], elevationFt: null, aroundFt: [], lowGround: null, fetchedMs: 0 }))
const surroundings = computed(() => (isBlock.value ? blockSurroundings.value : noSurroundings.value))

type TabId = 'route' | 'station' | 'micro' | 'estimate' | 'confidence' | 'profile' | 'wind' | 'numbers'
const tab = ref<TabId>('route')
/** The plain view answers "when can I go". Advanced adds the working behind it, for anyone who wants to check the confidence figure. */
const advanced = useState('plan-advanced', () => false)
const allTabs: { id: TabId; label: string; advanced?: boolean }[] = [
  { id: 'route', label: 'Tonight\'s route' }, { id: 'station', label: 'Against one weather station' }, { id: 'micro', label: 'This field\'s microclimate' },
  { id: 'estimate', label: 'Where the estimate comes from', advanced: true }, { id: 'confidence', label: 'How sure, and why', advanced: true },
  { id: 'profile', label: 'Air profile at this hour', advanced: true }, { id: 'wind', label: 'Wind at this hour', advanced: true }, { id: 'numbers', label: 'The numbers', advanced: true },
]
const tabs = computed(() => allTabs.filter(t => advanced.value || !t.advanced))
/** Turning Advanced on opens its first chart and brings it into view, so it is clear what was added. */
const evidence = ref<HTMLElement | null>(null)
watch(advanced, on => {
  if (on) { tab.value = 'profile'; nextTick(() => evidence.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }
  else if (allTabs.find(t => t.id === tab.value)?.advanced) tab.value = 'route'
})
const volatile = ref(false)
/** The walkthrough sets what the page shows at each step. */
function demoGo(step: { fieldId?: string; pickedMs?: number | null; stage?: 'map' | '3d'; tab?: string; advanced?: boolean }) {
  if (step.fieldId && step.fieldId !== fieldId.value) fieldId.value = step.fieldId
  if (step.advanced !== undefined) advanced.value = step.advanced
  // After the field and Advanced changes have settled.
  nextTick(() => nextTick(() => {
    if (step.pickedMs !== undefined) picked.value = step.pickedMs
    if (step.stage) stage.value = step.stage
    if (step.tab) tab.value = step.tab as TabId
  }))
}
const tower = computed(() => (plan.value ? towerModelFor(plan.value.terrain) : null))
const used = computed(() => plan.value?.estimate.stations.filter(s => s.weight >= 0.01) ?? [])
const signed = (n: number, unit = '') => `${n > 0 ? '+' : ''}${n}${unit}`
const ft = (m: number) => Math.round(Math.abs(m) * 3.281)
/** Age of the newest station reading, for the measured badge. */
const newestReading = computed(() => {
  const ts = (plan.value?.stations ?? []).map(s => s.timeMs).filter(t => Number.isFinite(t))
  if (!ts.length) return 'station readings'
  const mins = Math.max(0, Math.round((now.value - Math.max(...ts)) / 60_000))
  return `station readings, newest ${mins} min old`
})

const adding = ref(false)
function add(lat: number, lon: number) {
  adding.value = false
  fieldId.value = addField(lat, lon).id
}
function remove() {
  const id = field.value.id
  fieldId.value = 'block-3'
  removeField(id)
}

/** The route across every field on the page, in words, so the assistant can plan the night with the user. */
const routeText = computed(() => {
  if (!routeFields.value.length) return ''
  const r = planRoute(routeFields.value, { nowMs: now.value })
  const each = routeFields.value.map(f => `${f.name} (${f.lat.toFixed(3)}, ${f.lon.toFixed(3)}; job ${f.jobMinutes} min; windows: ${f.windows.slice(0, 3).map(w => `${fmtWhen(w.startMs, now.value)} to ${fmtWhen(w.endMs, now.value)}, start by ${fmtWhen(w.latestStartMs, now.value)}, ${pct(w.confidence)}`).join(' | ') || 'none'})`)
  return [
    `Route planning across the user's fields. Each field: ${each.join('; ')}.`,
    r.stops.length ? `Stillair's suggested order: ${r.stops.map((s, i) => `${i + 1}. ${s.name}: ${s.travelMinutes >= 1 ? `drive ${Math.round(s.travelMinutes)} min, ` : ''}start ${fmtWhen(s.startMs, now.value)}, finish ${fmtWhen(s.finishMs, now.value)}, confidence ${pct(s.confidence)}`).join('; ')}.` : 'No job fits a window, so there is no route to suggest.',
    r.deferred.length ? `Put off: ${r.deferred.map(d => `${d.name} (${d.reason})`).join('; ')}.` : '',
    `Expected cost of that plan about $${r.costUsd} with ${r.driveMiles} road miles (example rates: crew $250 an hour, fuel $0.60 a mile, wasted trip $400; drive time is straight-line distance x 1.3 at 35 mph). In list order it would be $${r.listOrder.costUsd} and ${r.listOrder.done} jobs done. When the user asks about order, timing or which field to drop, reason from these windows and this route; say which jobs are tight and why.`,
  ].filter(Boolean).join('\n')
})
/** What is on screen, in words, so the assistant answers from the same plan. */
const askContext = computed(() => {
  const p = plan.value
  if (!p) return ''
  const w = next.value
  return [
    `The user is planning ahead for ${field.value.name} (${field.value.lat}, ${field.value.lon}); the job takes ${minutes.value} minutes and will not be stopped once started.`,
    w ? `Next spray window: ${fmtWhen(w.startMs, now.value)} to ${fmtWhen(w.endMs, now.value)}; the job must start by ${fmtWhen(w.latestStartMs, now.value)}. Confidence ${pct(w.confidence)} (${confidenceWord(w.confidence)}).` : `No window of ${minutes.value} minutes in the next 48 hours meets every limit with at least 50% confidence.`,
    `All fields, soonest first: ${ordered.value.map(x => `${x.f.name} ${x.o.state}`).join('; ')}.`,
    routeText.value,
    `Microclimate: ${p.terrain.summary}`,
    `Field estimate now: ${p.estimate.tempF}°F, wind ${p.estimate.windMph} mph (weather model alone: ${p.estimate.model.tempF}°F, ${p.estimate.model.windMph} mph), corrected with ${used.value.length} stations; nearest ${used.value[0]?.name ?? 'none'} at ${used.value[0]?.distanceKm ?? '?'} km. Station coverage ${pct(p.estimate.support)}.`,
    `Accuracy test now across ${p.skill.n} stations (each hidden in turn): estimate off by ${p.skill.fusedTempF}°F and ${p.skill.fusedWindMph} mph on average; model alone ${p.skill.modelTempF}°F and ${p.skill.modelWindMph} mph. Confidence is derived from this error and grows less sure with hours ahead; it is not a validated probability.`,
    hour.value ? `Hour being previewed: ${fmtWhen(hour.value.timeMs, now.value)}: ${hour.value.status}, confidence ${pct(hour.value.confidence)}, ${signed(hour.value.deltaF, '°F')} between 5 ft and 30 ft, wind ${hour.value.lowWindMph} mph at 5 ft and ${hour.value.highWindMph} mph at 30 ft, gusts ${hour.value.gustMph} mph. ${hour.value.reasons.join(' ')}` : '',
  ].filter(Boolean).join('\n')
})
</script>

<template>
  <main class="now">
    <GuidedDemo :hours="plans['block-3']?.hours ?? []" @go="demoGo" />
    <div class="topline">
      <div class="blocktabs" role="tablist" aria-label="Fields, soonest window first">
        <button v-for="x in ordered" :key="x.f.id" role="tab" :aria-selected="x.f.id === fieldId" :class="[x.o.status ?? 'wait', { on: x.f.id === fieldId }]" @click="fieldId = x.f.id">
          <span class="name">{{ x.f.name }}</span><span class="state">{{ x.o.state }}</span>
        </button>
      </div>
      <button class="whatifbtn" :class="{ on: adding }" :aria-pressed="adding" @click="adding = !adding; stage = 'map'">{{ adding ? 'Click the map to place the field' : 'Add a field' }}</button>
      <button v-for="p in presets" :key="p.name" class="presetbtn" @click="addPreset(p)">+ {{ p.name }}</button>
      <select :value="example ? 'example' : 'live'" aria-label="Weather shown" class="sourcepick" @change="setExample(($event.target as HTMLSelectElement).value === 'example')">
        <option value="live">Live forecast</option>
        <option value="example">Example day (scripted)</option>
      </select>
      <button class="presetbtn advbtn" :class="{ on: advanced }" :aria-pressed="advanced" @click="advanced = !advanced">{{ advanced ? 'Hide the working' : 'Advanced: show the working' }}</button>
      <div class="clock"><span class="muted">Fields are ordered by soonest window. {{ fmtStamp(now) }}</span></div>
    </div>

    <p class="pitchline">Your weather station sees one point at one height. Stillair estimates the air over your field from every public station, says how sure it is, and finds the window your whole job fits in.</p>

    <p v-if="example" class="examplenote" role="status"><strong>Example day.</strong> The hours ahead are a scripted, typical clear autumn day, not today's forecast. Stations, terrain and buildings are real. Switch to "Live forecast" for the real plan.</p>
    <div class="split">
      <aside class="decide">
        <div class="banner plan" :class="!plan ? 'wait' : openNow ? 'GO' : next ? 'CAUTION' : chance ? 'marginal' : 'STOP'" role="status" aria-live="polite">
          <div class="where">{{ field.name }} · next window for a {{ minutes }} minute job</div>
          <template v-if="!plan">
            <div class="big">{{ errors[field.id] ? 'No data' : 'Working' }}</div>
            <div class="why">{{ errors[field.id] ?? 'Reading the stations, the forecast and the terrain around this field.' }}</div>
          </template>
          <template v-else-if="next">
            <div class="big">{{ openNow ? 'Open now' : fmtWhen(next.startMs, now) }}</div>
            <div class="why">
              {{ openNow ? 'Open' : 'Then open' }} until {{ fmtWhen(next.endMs, now) }}. Start by <strong>{{ fmtWhen(next.latestStartMs, now) }}</strong> to finish inside it.
            </div>
            <div class="conf"><span>Confidence</span><strong>{{ pct(next.confidence) }}</strong><span>{{ confidenceWord(next.confidence) }}</span></div>
          </template>
          <template v-else-if="chance">
            <div class="where" style="margin-top:8px">No firm window. Best chance:</div>
            <div class="big">{{ fmtWhen(chance.startMs, now) }}</div>
            <div class="why">{{ chance.reason }}</div>
            <div class="conf"><span>Chance of finishing clear</span><strong>{{ pct(chance.confidence) }}</strong><span>below the 50% bar</span></div>
          </template>
          <template v-else>
            <div class="big">No window</div>
            <div class="why">Every stretch of {{ minutes }} minutes in the next 48 hours has a hard stop in it: an inversion, wind over the limit, or wind toward buildings.</div>
          </template>
        </div>
        <p v-if="plan" class="badgeline"><SourceBadge kind="estimated" :detail="`from ${plan.stations.length} stations and the forecast, ${fmtTime(plan.generatedMs)}`" /></p>

        <section v-if="plan">
          <PlanText :field="field" :job-minutes="minutes" />
        </section>

        <section>
          <h2>The job</h2>
          <JobInputs :field-id="field.id" />
        </section>

        <section v-if="plan">
          <h2>What you need to know</h2>
          <PlanAnswers :hours="plan.hours" :window="answerWindow" :job-minutes="minutes" :now-ms="now" :trip-cost-usd="tripCostUsd" :volatile="volatile" />
          <label class="check" style="margin:12px 0 0"><input v-model="volatile" type="checkbox"> This product gives off vapor (volatile)</label>
          <p v-if="clears" class="muted" style="margin:10px 0 0">The warm-over-cool layer is expected to clear around <strong style="color:var(--ink)">{{ fmtWhen(clears.p50Ms, now) }}</strong> (most likely between {{ fmtTime(clears.p10Ms) }} and {{ fmtTime(clears.p90Ms) }}). Read from this plan's hourly estimate across 200 simulated outcomes, not from a heating model.</p>
          <label class="tripcost">Cost of a wasted trip (crew, fuel, setup), $<input v-model.number="tripCostUsd" type="number" min="0" step="50"></label>
        </section>

        <section v-if="windows.length > 1">
          <h2>Later windows</h2>
          <div v-for="w in windows.slice(1, 4)" :key="w.startMs" class="winrow">
            <button class="linkbtn" @click="picked = w.startMs">{{ fmtWhen(w.startMs, now) }} to {{ fmtWhen(w.endMs, now) }}</button>
            <span class="muted">start by {{ fmtTime(w.latestStartMs) }} · {{ pct(w.confidence) }}</span>
          </div>
        </section>

        <section v-if="hour">
          <h2>{{ fmtWhen(hour.timeMs, now) }} at this field <span class="chip" :class="hour.status">{{ hour.status }}</span></h2>
          <p class="badgeline" style="margin:0 0 6px"><SourceBadge kind="estimated" detail="5 ft and 30 ft, not a sensor on this field" /></p>
          <p class="hourline">
            <strong>{{ signed(hour.deltaF, '°F') }}</strong> from 5 ft to 30 ft ·
            wind <strong>{{ hour.lowWindMph }}</strong> mph at 5 ft, <strong>{{ hour.highWindMph }}</strong> at 30 ft, gusts <strong>{{ hour.gustMph }}</strong> ·
            confidence <strong>{{ pct(hour.confidence) }}</strong>
          </p>
          <p v-for="r in hour.reasons" :key="r" class="trigger plain">{{ r }}</p>
          <p v-if="!hour.reasons.length" class="trigger plain">No inversion expected, and wind is forecast inside the limits at both heights.</p>
        </section>

        <section v-if="plan">
          <h2>Why this field is different</h2>
          <p style="margin:0">{{ plan.terrain.summary }}</p>
          <NuxtLink v-if="isBlock" :to="`/now?block=${field.id}`" class="linkbtn" style="display:inline-block">See live conditions and log a job on {{ field.name }}</NuxtLink>
          <button v-else class="linkbtn" @click="remove">Remove {{ field.name }}</button>
        </section>

        <section>
          <h2>Ask Stillair</h2>
          <AskBox :context="askContext" :examples="['What order should I do my fields in tonight?', 'When is the best time to spray this field?', '¿Qué campo debo dejar para mañana?']" />
        </section>
      </aside>

      <div class="evidence">
        <section v-if="fields.length > 1" class="card">
          <div class="cardhead">
            <h2>The next 48 hours, every field</h2>
            <span class="muted">Share of outcomes that are sprayable (green), marginal (amber) or closed (red). Dark bars on top: windows the whole job fits. Click any hour.</span>
          </div>
          <FieldsOverview :fields="ordered.map(x => x.f)" :plans="plans" :selected-id="field.id" :selected-ms="hour?.timeMs ?? 0" :windows="Object.fromEntries(fields.map(f => [f.id, windowsFor(f.id)]))" :now-ms="now" @select="(id, ms) => { fieldId = id; nextTick(() => { picked = ms || null }) }" />
        </section>

        <section class="card">
          <div class="cardhead">
            <h2>The next 48 hours at {{ field.name }}</h2>
            <SourceBadge v-if="plan" kind="estimated" :detail="`${fmtTime(plan.generatedMs)} from ${plan.stations.length} stations and the forecast model`" />
          </div>
          <template v-if="plan">
            <ConfidenceChart :hours="plan.hours" :windows="windows" :selected="hour?.timeMs ?? 0" :now-ms="now" :height="150" @select="picked = $event" />
            <p class="muted striplegend">Each hour shows the share of outcomes that are <span style="color:var(--go)">sprayable</span>, <span style="color:var(--caution)">marginal</span> or <span style="color:#ff7864">closed</span>, given the measured error of the estimate. The thin strip underneath is the most likely outcome. Dark bars on top are windows the whole job fits in; the blue line is now. It is a confidence index, not a calibrated probability. Click an hour to preview it.</p>
          </template>
          <p v-else class="muted">{{ errors[field.id] ?? 'Loading the plan…' }}</p>
        </section>

        <section class="card stagecard">
          <div class="cardhead">
            <h2 v-if="stage === 'map'">{{ adding ? 'Click where the new field is' : `Stations informing ${field.name}` }}</h2>
            <h2 v-else>Where spray would go at {{ hour ? fmtWhen(hour.timeMs, now) : '' }}</h2>
            <div class="seg" role="group" aria-label="View">
              <button :class="{ on: stage === 'map' }" @click="stage = 'map'">Map</button>
              <button :class="{ on: stage === '3d' }" @click="stage = '3d'">3D at this hour</button>
            </div>
          </div>
          <PlanMap v-if="stage === 'map'" :fields="fields" :plan="plan" :selected="field.id" :statuses="hourStatuses" :adding="adding" @select="fieldId = $event" @add="add" />
          <div v-else>
            <Drift3D :key="field.id" :blocks="sceneBlocks" :models="sceneModels" :selected="field.id" :surroundings="surroundings" droplet="medium" />
            <p v-if="!isBlock" class="muted">This field's boundary has not been traced, so it is drawn as a square of {{ jobFor(field.id).acres }} acres. Buildings and addresses are not loaded for this area.</p>
          </div>
          <p v-if="stage !== 'map'" class="badgeline"><SourceBadge kind="estimated" detail="drift model, compares conditions, not a deposition forecast" /></p>
        </section>

        <section v-if="plan" ref="evidence" class="card">
          <div class="tabs" role="tablist" aria-label="Evidence">
            <button v-for="t in tabs" :key="t.id" role="tab" :aria-selected="tab === t.id" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
          </div>

          <NightPlan v-if="tab === 'route'" :fields="routeFields" :now-ms="now" @select="fieldId = $event" />
          <PlanValidation v-else-if="tab === 'station'" :skill="plan.skill" :stations="plan.skill.n" />

          <div v-else-if="tab === 'profile'" class="grid2">
            <VerticalProfile :reading="hour?.reading ?? null" />
            <div><h2>Is the air mixing?</h2><MixingGauge :ri="hourEval?.ri ?? 0" /><p class="muted">Estimated for {{ hour ? fmtWhen(hour.timeMs, now) : '' }} from the forecast, the station correction and this field's terrain. Not a measurement.</p></div>
          </div>
          <Hodograph v-else-if="tab === 'wind'" :reading="hour?.reading ?? null" />
          <CalcDetails v-else-if="tab === 'numbers'" :reading="hour?.reading ?? null" :ground="null" />

          <div v-else-if="tab === 'estimate'">
            <p class="mapfact" style="margin-top:0">
              <SourceBadge kind="modelled" /> There is no weather station on this field. The forecast model alone says <strong>{{ plan.estimate.model.tempF }}°F</strong> and <strong>{{ plan.estimate.model.windMph }} mph</strong> here right now.
              <template v-if="used.length">Comparing the model with what {{ used.length }} nearby {{ used.length === 1 ? 'station measures' : 'stations measure' }} moves that to <strong>{{ plan.estimate.tempF }}°F</strong> and <strong>{{ plan.estimate.windMph }} mph</strong>.</template>
              <template v-else>No station is close enough to correct it, so the plan rests on the model and confidence is lowered.</template>
            </p>
            <p class="badgeline" style="margin:0 0 8px"><SourceBadge kind="measured" :detail="newestReading" /> <SourceBadge kind="estimated" detail="the field result, worked out from the model and the stations" /></p>
            <div class="tablewrap">
              <table>
                <thead><tr><th>Station</th><th>Network</th><th>Distance</th><th>Elevation vs field</th><th>Measured</th><th>Model was off by</th><th>Weight</th></tr></thead>
                <tbody>
                  <tr v-for="s in plan.estimate.stations" :key="s.id">
                    <td>{{ s.name }}</td><td>{{ s.network }}</td><td class="num">{{ s.distanceKm }} km</td><td class="num">{{ signed(ft(s.dElevM) * Math.sign(s.dElevM), ' ft') }}</td>
                    <td class="num">{{ plan.stations.find(x => x.id === s.id)?.tempF }}°F, {{ plan.stations.find(x => x.id === s.id)?.windMph }} mph</td>
                    <td class="num">{{ signed(s.dTempF, '°F') }}, {{ signed(s.dWindMph, ' mph') }}</td><td class="num">{{ pct(s.weight) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="muted">Stations count for more when they are nearer and at a similar elevation: 330 ft of height difference counts like 12 km of distance. The correction fades over the hours ahead (half after 6 hours) because it describes now. AZMet wind is measured at 10 ft and adjusted to the model's 33 ft.</p>
          </div>

          <div v-else-if="tab === 'micro'">
            <p class="badgeline" style="margin:0 0 8px"><SourceBadge kind="modelled" detail="90 m terrain model" /></p>
            <p class="mapfact" style="margin-top:0">{{ plan.terrain.summary }}</p>
            <div class="facts">
              <div><span>Elevation</span>{{ Math.round(plan.terrain.elevM * 3.281).toLocaleString() }} ft</div>
              <div><span>Against land within 500 m</span>{{ ft(plan.terrain.relief500M) }} ft {{ plan.terrain.relief500M < 0 ? 'lower' : 'higher' }}</div>
              <div><span>Against land within 2 km</span>{{ ft(plan.terrain.relief2kmM) }} ft {{ plan.terrain.relief2kmM < 0 ? 'lower' : 'higher' }}</div>
              <div><span>Against land within 6 km</span>{{ ft(plan.terrain.relief6kmM) }} ft {{ plan.terrain.relief6kmM < 0 ? 'lower' : 'higher' }}</div>
              <div><span>Slope</span>{{ plan.terrain.slopePct }}%, falling toward the {{ plan.terrain.drainsToward }}</div>
              <div><span>Cold-air pooling</span>{{ pct(plan.terrain.coldPool) }}</div>
            </div>
            <p v-if="tower" class="muted">
              What that changes in the forecast: an inversion is expected here once the air 260 ft up is {{ tower.offsetF }}°F warmer than the surface air (on open flat ground: 6°F), and it is taken to be {{ tower.factor }} times as strong as the regional signal (flat ground: 0.5).
              Elevations come from a 90 m terrain model at 25 points around the field. These terrain factors are our reasoning from how cold air drains, not yet fitted to tower measurements.
            </p>
          </div>

          <div v-else>
            <div class="backtest" style="margin-top:0;padding-top:0;border-top:0">
              <span class="headline">±{{ plan.sigma.tempF }}°F</span>
              <span>is the typical error of this method right now, with ±{{ plan.sigma.windMph }} mph on wind.
                <span class="muted">Measured by hiding each of {{ plan.skill.n }} stations in turn and estimating it from the others: off by {{ plan.skill.fusedTempF }}°F and {{ plan.skill.fusedWindMph }} mph on average. The forecast model alone was off by {{ plan.skill.modelTempF }}°F and {{ plan.skill.modelWindMph }} mph.</span></span>
            </div>
            <p>Confidence for an hour is the chance that wind stays inside both limits and no inversion forms, given that error. It falls as the forecast looks further ahead and when a value sits close to a limit. The error is taken as half the measured figure when a station sits beside the field and one and a half times it when none is in range (coverage here: {{ pct(plan.estimate.support) }}); that scaling is our assumption. A window's confidence is for the whole job: the share of 200 simulated outcomes, with errors that carry over from hour to hour, in which every hour of the job stays inside the limits.</p>
            <p class="muted">This is a confidence figure built from today's measured error. It has not been checked against a season of outcomes, so read it as a guide to which windows are firm and which are marginal, not as a guaranteed probability.</p>
          </div>
        </section>
      </div>
    </div>
  </main>
</template>
