<script setup lang="ts">
import { BLOCKS, areaAcres, evaluate, localOutline, scenarioById, sprayEconomics, whatIfReading, type BlockSnapshot } from '@drift/engine'

const { snap, api } = useRanch()
const route = useRoute()
const blockId = ref(String(route.query.block ?? 'block-3'))
const liveBlock = computed(() => snap.value?.blocks.find(b => b.id === blockId.value) ?? null)
const whatIf = useWhatIf()
/** In what-if mode the chosen conditions stand in for the live reading, run through the same rules. */
const block = computed<BlockSnapshot | null>(() => {
  const live = liveBlock.value
  if (!live || !whatIf.on.value) return live
  const reading = whatIfReading(live.id, whatIf.w.value, snap.value?.nowMs ?? Date.now())
  const evaluation = evaluate({ history: [reading], nowMs: Date.parse(reading.time), sites: live.sites })
  return { ...live, reading, evaluation, window: null }
})
/** Every block as the views should draw it: the selected one may be showing what-if conditions. */
const blocks = computed(() => (snap.value?.blocks ?? []).map(b => (b.id === blockId.value && block.value ? block.value : b)))
const ev = computed(() => block.value?.evaluation ?? null)
const session = computed(() => snap.value?.sessions.find(s => s.blockId === blockId.value && s.phase !== 'closed') ?? null)
const surroundings = useSurroundings(blockId)
const bufferM = useBufferM()
const facts = computed(() => downwindFacts(block.value, surroundings.value, bufferM.value))
const droplet = computed(() => (whatIf.on.value ? whatIf.quality.value : session.value?.job.droplet ?? whatIf.quality.value))

/** The one large view on the right, and the one piece of evidence under it. */
const stage = ref<'3d' | 'side' | 'map'>('3d')
const tab = ref<'timeline' | 'profile' | 'wind' | 'hours' | 'compare' | 'numbers'>('timeline')
const tabs = [
  { id: 'timeline', label: 'Timeline' }, { id: 'profile', label: 'Air profile' }, { id: 'wind', label: 'Wind' },
  { id: 'hours', label: 'Best hours' }, { id: 'compare', label: 'Ground station vs two heights' }, { id: 'numbers', label: 'The numbers' },
] as const
function open(what: 'profile' | 'wind' | 'map') {
  if (what === 'map') stage.value = 'map'
  else tab.value = what
}

const history = ref<{ history: any[]; forecast: any[] }>({ history: [], forecast: [] })
const backtest = ref<any>(null)
async function refresh() {
  try { history.value = await $fetch<any>(`${api}/api/blocks/${blockId.value}/history`) } catch { /* keep the last data */ }
}
let timer: ReturnType<typeof setInterval>
onMounted(async () => {
  refresh()
  timer = setInterval(refresh, 5000)
  backtest.value = await $fetch(`${api}/api/backtest`).catch(() => null)
})
onBeforeUnmount(() => clearInterval(timer))
watch(blockId, refresh)

const field = computed(() => localOutline(BLOCKS.find(b => b.id === blockId.value) ?? BLOCKS[0]!))
const acres = computed(() => areaAcres(field.value))
/** What spraying in these conditions would lose, from the drift model. */
const econ = computed(() => (block.value?.reading ? sprayEconomics(block.value.reading, droplet.value, acres.value, whatIf.costPerAcre.value || 0, { field: field.value }) : null))
/** What is on screen, in words, so the assistant answers about the same numbers the user sees. */
const askContext = computed(() => {
  const b = block.value, e = econ.value, v = b?.evaluation
  if (!b || !v || !e) return ''
  const lines = [
    whatIf.on.value ? `The user is exploring a WHAT-IF scenario for ${b.name}, not live conditions: ${v.deltaF > 0 ? '+' : ''}${v.deltaF}°F between 5 ft and 30 ft, wind ${whatIf.w.value.lowWindMph} mph at 5 ft and ${whatIf.w.value.highWindMph} mph at 30 ft from the ${compass(whatIf.w.value.windFromDeg)}. Under those conditions the rules give ${v.status}. Reasons: ${v.triggers.map(t => t.text).join(' ') || 'none'}` : `The user is looking at ${b.name}.`,
    `Drift model estimate for ${b.name} (${acres.value} acres, ${droplet.value} spray quality, $${whatIf.costPerAcre.value} per acre): ${e.offTargetPct}% of the spray would leave the block (${e.offLowPct}% near the ground, ${e.aloftPct}% aloft), about $${e.wastedUsd} of a $${e.costUsd} application, and it would take ${e.extraPct}% more product to put the full dose on the trees.`,
    facts.value && !facts.value.calm ? `Spray would be carried toward the ${facts.value.dir}; ${facts.value.addresses.length} addresses lie within ${bufferM.value} m that way.` : '',
  ]
  return lines.filter(Boolean).join('\n')
})
const marks = computed(() => (snap.value?.demo.mode === 'scenario' ? scenarioById(snap.value.demo.scenarioId).marks : []))
const jump = (min: number) => $fetch(`${api}/api/demo`, { method: 'POST', body: { seekMin: min } }).then(refresh)
const blockName = computed(() => BLOCKS.find(b => b.id === blockId.value)?.name ?? '')
const feeds = computed(() => (snap.value?.sources ?? []).filter(s => s.role === 'Tower' || s.role === 'Ground station').map(s => `${s.role}: ${s.kind}, ${s.adapter}`).join('. '))
const mode = computed(() => ({ live: 'Live', scenario: 'Scripted night', replay: 'Replay of a real night' })[snap.value?.demo.mode ?? 'live'])
</script>

<template>
  <main class="now">
    <div class="topline">
      <div class="blocktabs" role="tablist" aria-label="Block">
        <button v-for="b in snap?.blocks ?? []" :key="b.id" role="tab" :aria-selected="b.id === blockId" :class="[b.evaluation?.status ?? 'wait', { on: b.id === blockId }]" @click="blockId = b.id">
          <span class="name">{{ b.name }}</span><span class="state">{{ b.evaluation?.status ?? 'WAIT' }}</span>
        </button>
      </div>
      <button class="whatifbtn" :class="{ on: whatIf.on.value }" :aria-pressed="whatIf.on.value" @click="whatIf.on.value = !whatIf.on.value">{{ whatIf.on.value ? 'Back to live conditions' : 'What if…' }}</button>
      <div v-if="marks.length && !whatIf.on.value" class="jumps" style="margin:0">
        <span class="muted">Jump to</span>
        <button v-for="m in marks" :key="m.label" @click="jump(m.min)">{{ m.label }}</button>
      </div>
      <div class="muted clock">{{ mode }}, {{ snap ? fmtStamp(snap.nowMs) : '' }}</div>
    </div>

    <WhatIfBar v-if="whatIf.on.value" />

    <div class="split">
      <aside class="decide">
        <StatusBanner :evaluation="ev" :where="block ? `${whatIf.on.value ? 'What-if: ' : ''}${block.name}, ${block.note.toLowerCase()}` : undefined" />
        <div v-if="!whatIf.on.value" class="next">
          <span class="muted">Next safe window</span>
          <strong v-if="ev?.status === 'GO'">Open now</strong>
          <strong v-else-if="block?.window">{{ fmtTime(block.window.startMs) }} to {{ fmtTime(block.window.endMs) }}</strong>
          <strong v-else>None in the next 36 hours</strong>
        </div>

        <section>
          <h2>Why</h2>
          <WhyList :block="block" :facts="facts" :buffer-m="bufferM" @open="open" />
        </section>

        <section v-if="!whatIf.on.value">
          <h2>Log a spray job</h2>
          <JobPanel :block-id="blockId" />
        </section>

        <section>
          <h2>{{ whatIf.on.value ? 'If you sprayed in these conditions' : 'If you sprayed now' }}</h2>
          <SprayCost :econ="econ" :acres="acres" :status="ev?.status ?? null" />
        </section>

        <section>
          <h2>Ask Stillair</h2>
          <AskBox :context="askContext" />
        </section>
      </aside>

      <div class="evidence">
        <section class="card stagecard">
          <div class="cardhead">
            <h2>{{ stage === 'map' ? `What lies around ${blockName}` : `Where spray from ${blockName} would go` }}</h2>
            <div class="seg" role="group" aria-label="View">
              <button :class="{ on: stage === '3d' }" @click="stage = '3d'">3D</button>
              <button :class="{ on: stage === 'side' }" @click="stage = 'side'">Side view</button>
              <button :class="{ on: stage === 'map' }" @click="stage = 'map'">Map</button>
            </div>
          </div>
          <Drift3D v-if="stage === '3d'" :blocks="blocks" :selected="blockId" :surroundings="surroundings" :droplet="droplet" />
          <div v-else-if="stage === 'side'" class="sidestage">
            <TowerScene :reading="block?.reading ?? null" :delta-f="ev?.deltaF ?? 0" :ri="ev?.ri ?? 0" :droplet="droplet" :site="block?.sites[0] ?? null" />
          </div>
          <BlockMap v-else :blocks="blocks" :selected="blockId" :surroundings="surroundings" @select="blockId = $event" />
        </section>

        <section class="card">
          <div class="tabs" role="tablist" aria-label="Evidence">
            <button v-for="t in tabs" :key="t.id" role="tab" :aria-selected="tab === t.id" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
          </div>

          <div v-if="tab === 'timeline'">
            <p v-if="whatIf.on.value" class="muted">The timeline shows what was actually measured and forecast, not the what-if conditions.</p>
            <Timeline :history="history.history" :forecast="history.forecast" />
          </div>
          <div v-else-if="tab === 'profile'" class="grid2">
            <VerticalProfile :reading="block?.reading ?? null" />
            <div><h2>Is the air mixing?</h2><MixingGauge :ri="ev?.ri ?? 0" /></div>
          </div>
          <Hodograph v-else-if="tab === 'wind'" :reading="block?.reading ?? null" />
          <WindowRanking v-else-if="tab === 'hours'" :block-id="blockId" :forecast="history.forecast" :surroundings="surroundings" :droplet="droplet" :now="liveBlock?.reading ?? null" :cost-per-acre="whatIf.costPerAcre.value || 0" />
          <div v-else-if="tab === 'compare'">
            <CompareTable :block="block" :ground="snap?.ground ?? null" />
            <div v-if="backtest" class="backtest">
              <span class="headline">{{ backtest.result.missedNights.length }} of {{ backtest.result.nightsCompared }} nights</span>
              <span>in 2025 had an inversion aloft while this ground station's wind looked fine for spraying.
                <span class="muted">{{ backtest.result.missedHours }} hours in total. Model-indicated: the upper-air temperatures come from Open-Meteo's historical forecast, not a tower.</span></span>
            </div>
          </div>
          <CalcDetails v-else :reading="block?.reading ?? null" :ground="snap?.ground ?? null" />
        </section>

        <p class="muted feeds">{{ feeds }}. <NuxtLink to="/setup">Data sources and setup</NuxtLink></p>
      </div>
    </div>
  </main>
</template>
