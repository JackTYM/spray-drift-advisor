<script setup lang="ts">
import { BLOCKS, areaAcres, localOutline, rankWindows, sprayEconomics, type Job, type RankedWindow, type Reading, type Status, type Surroundings } from '@drift/engine'

const props = defineProps<{ now: Reading | null; costPerAcre: number; blockId: string; forecast: { timeMs: number; status: Status; reading?: Reading }[]; surroundings: Surroundings | null; droplet: Job['droplet'] }>()

const receptors = computed(() => (props.surroundings?.addresses ?? []).filter(a => a.distanceM <= 600).slice(0, 12).map(a => {
  const b = (a.bearingDeg * Math.PI) / 180
  return { label: a.label, x: a.distanceM * Math.sin(b), y: a.distanceM * Math.cos(b) }
}))
const ranked = ref<(RankedWindow & { lostPct: number; lostUsd: number })[]>([])
const field = computed(() => localOutline(BLOCKS.find(b => b.id === props.blockId) ?? BLOCKS[0]!))
/** The same loss estimate for spraying right now, to compare the best hour against. */
const nowLoss = computed(() => (props.now ? sprayEconomics(props.now, props.droplet, areaAcres(field.value), props.costPerAcre, { field: field.value, n: 120 }) : null))
// The model run is heavy, so it repeats only when the forecast, the droplet size or the receptors change.
const key = computed(() => `${props.costPerAcre}:${props.blockId}:${props.forecast[0]?.timeMs}:${props.forecast.map(f => f.status[0]).join('')}:${props.droplet}:${receptors.value.length}`)
watch(key, () => {
  const usable = props.forecast.filter((f): f is { timeMs: number; status: Status; reading: Reading } => !!f.reading)
  const acres = areaAcres(field.value)
  ranked.value = (usable.length ? rankWindows(usable, props.droplet, receptors.value, field.value).slice(0, 4) : []).map(w => {
    const at = usable.find(f => f.timeMs === w.startMs)!
    const e = sprayEconomics(at.reading, props.droplet, acres, props.costPerAcre, { field: field.value, n: 120 })
    return { ...w, lostPct: e.offTargetPct, lostUsd: e.wastedUsd }
  })
}, { immediate: true })
</script>

<template>
  <div>
    <p v-if="nowLoss && ranked.length" class="mapfact" style="margin-top:0">
      Spraying now would lose about <strong>${{ nowLoss.wastedUsd.toLocaleString('en-US') }}</strong> ({{ nowLoss.offTargetPct }}% of the spray).
      The best hour, {{ fmtTime(ranked[0]!.startMs) }}, would lose about <strong>${{ ranked[0]!.lostUsd.toLocaleString('en-US') }}</strong>.
    </p>
    <div v-if="!ranked.length" class="muted">No full hour of Go conditions in the next 18 hours.</div>
    <div v-else class="tablewrap">
      <table>
        <thead><tr><th></th><th>Hour</th><th>Spray lost</th><th>Cost of the loss</th><th>Most exposed address</th></tr></thead>
        <tbody>
          <tr v-for="(w, i) in ranked" :key="w.startMs">
            <td><span v-if="i === 0" class="chip GO">BEST</span></td>
            <td class="num">{{ fmtTime(w.startMs) }} to {{ fmtTime(w.endMs) }}</td>
            <td class="num">{{ w.lostPct }}%</td>
            <td class="num">${{ w.lostUsd.toLocaleString('en-US') }}</td>
            <td>{{ w.worstReceptor === null ? 'None reached' : `${receptors[w.worstReceptor]?.label}: ${w.worstPerThousand} per 1,000` }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="muted">Every hour listed is Go. They are ranked by the drift model, {{ droplet }} droplets, so the first is the hour when the least spray is expected to leave the block. Model estimates for comparing hours, not measured amounts.</p>
  </div>
</template>
