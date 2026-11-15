<script setup lang="ts">
import { ends, worst, type BlockSnapshot, type Status } from '@drift/engine'

const props = defineProps<{ block: BlockSnapshot | null; facts: ReturnType<typeof downwindFacts>; bufferM: number }>()
defineEmits<{ open: [what: 'profile' | 'wind' | 'map'] }>()

const levelOf = (rules: string[]): Status =>
  (props.block?.evaluation?.triggers ?? []).filter(t => rules.includes(t.rule)).reduce<Status>((s, t) => worst(s, t.level), 'GO')

const lines = computed(() => {
  const ev = props.block?.evaluation
  const r = props.block?.reading
  if (!ev || !r) return []
  const { lo, hi } = ends(r)
  const stale = ev.triggers.some(t => t.rule === 'stale-data')
  const air = stale ? 'No fresh tower reading, so the air is unknown.'
    : ev.deltaF > 0 ? `The air is layered: ${hi.heightFt} ft is ${ev.deltaF}°F warmer than ${lo.heightFt} ft${ev.ri > 0.25 ? ', and it is not mixing' : ''}.`
    : ev.triggers.some(t => t.rule === 'inversion-forming') ? 'An inversion is likely to form soon.'
    : `The air is mixing: it cools ${Math.abs(ev.deltaF)}°F from ${lo.heightFt} ft to ${hi.heightFt} ft.`
  const f = props.facts
  return [
    { key: 'profile' as const, title: 'Air', text: air, level: stale ? 'CAUTION' as Status : levelOf(['inversion', 'inversion-forming']) },
    { key: 'wind' as const, title: 'Wind', text: `${lo.windMph} mph at ${lo.heightFt} ft and ${hi.windMph} mph at ${hi.heightFt} ft, from the ${compass(lo.windDirDeg)}.`, level: levelOf(['wind-low', 'wind-high', 'speed-shear', 'direction-shear']) },
    { key: 'map' as const, title: 'Downwind',
      text: !f ? 'Loading what lies around the block.' : f.calm ? 'Near calm, so drift has no clear direction.'
        : `Toward the ${f.dir}: ${f.addresses.length} ${f.addresses.length === 1 ? 'address' : 'addresses'} within ${props.bufferM} m.`,
      level: levelOf(['sensitive-site']) },
  ]
})
</script>

<template>
  <div class="why">
    <button v-for="l in lines" :key="l.key" class="whyline" :class="l.level" @click="$emit('open', l.key)">
      <span class="dot" aria-hidden="true"></span>
      <span><strong>{{ l.title }}</strong> {{ l.text }}</span>
      <span class="go" aria-hidden="true">›</span>
    </button>
    <div v-if="!lines.length" class="muted">Waiting for the first tower reading.</div>
  </div>
</template>
