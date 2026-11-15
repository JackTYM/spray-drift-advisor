<script setup lang="ts">
import { ends, type BlockSnapshot, type GroundObs } from '@drift/engine'

const props = defineProps<{ block: BlockSnapshot | null; ground: GroundObs | null }>()
const ev = computed(() => props.block?.evaluation ?? null)
const lv = computed(() => (props.block?.reading ? ends(props.block.reading) : null))
const flags = computed(() => ev.value?.triggers.filter(t => t.rule !== 'holding').length ?? 0)
</script>

<template>
  <div v-if="!ev || !lv" class="muted">Waiting for a reading.</div>
  <div v-else class="compare">
    <div>
      <div class="label">One ground station{{ ground ? ` (${ground.station})` : '' }}</div>
      <span class="chip" :class="ev.groundOnly.status">{{ ev.groundOnly.status }}</span>
      <p v-if="ground">{{ ground.tempF }}°F, {{ ground.windMph }} mph from the {{ compass(ground.windDirDeg) }}</p>
      <p class="muted">{{ ev.groundOnly.triggers[0]?.text ?? 'Wind is within limits, so it looks fine.' }} It cannot detect an inversion or the wind above the canopy.</p>
    </div>
    <div>
      <div class="label">Two heights ({{ lv.lo.heightFt }} ft and {{ lv.hi.heightFt }} ft)</div>
      <span class="chip" :class="ev.status">{{ ev.status }}</span>
      <p>{{ flags }} {{ flags === 1 ? 'flag' : 'flags' }}. ΔT {{ ev.deltaF > 0 ? '+' : '' }}{{ ev.deltaF }}°F, Ri {{ ev.ri.toFixed(2) }}</p>
      <p class="muted">{{ lv.hi.heightFt }} ft wind: {{ lv.hi.windMph }} mph from the {{ compass(lv.hi.windDirDeg) }}</p>
    </div>
  </div>
</template>
