<script setup lang="ts">
import { rankWindows, type Job, type RankedWindow, type Reading, type Status, type Surroundings } from '@drift/engine'

const props = defineProps<{ forecast: { timeMs: number; status: Status; reading?: Reading }[]; surroundings: Surroundings | null; droplet: Job['droplet'] }>()

const receptors = computed(() => (props.surroundings?.addresses ?? []).filter(a => a.distanceM <= 600).slice(0, 12).map(a => {
  const b = (a.bearingDeg * Math.PI) / 180
  return { label: a.label, x: a.distanceM * Math.sin(b), y: a.distanceM * Math.cos(b) }
}))
const ranked = ref<RankedWindow[]>([])
// The model run is heavy, so it repeats only when the forecast, the droplet size or the receptors change.
const key = computed(() => `${props.forecast[0]?.timeMs}:${props.forecast.map(f => f.status[0]).join('')}:${props.droplet}:${receptors.value.length}`)
watch(key, () => {
  const usable = props.forecast.filter((f): f is { timeMs: number; status: Status; reading: Reading } => !!f.reading)
  ranked.value = usable.length ? rankWindows(usable, props.droplet, receptors.value).slice(0, 4) : []
}, { immediate: true })
</script>

<template>
  <div>
    <div v-if="!ranked.length" class="muted">No full hour of Go conditions in the next 18 hours.</div>
    <div v-else class="tablewrap">
      <table>
        <thead><tr><th></th><th>Hour</th><th>Droplets leaving the block, low</th><th>Most exposed address</th></tr></thead>
        <tbody>
          <tr v-for="(w, i) in ranked" :key="w.startMs">
            <td><span v-if="i === 0" class="chip GO">BEST</span></td>
            <td class="num">{{ fmtTime(w.startMs) }} to {{ fmtTime(w.endMs) }}</td>
            <td class="num">{{ w.offLowPct }}%</td>
            <td>{{ w.worstReceptor === null ? 'None reached' : `${receptors[w.worstReceptor]?.label}: ${w.worstPerThousand} per 1,000` }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="muted">Every hour listed is Go. They are ranked by the drift model, {{ droplet }} droplets, so the first is the hour when the least spray is expected to leave the block. A comparison between hours, not a measured amount.</p>
  </div>
</template>
