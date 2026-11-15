<script setup lang="ts">
import type { SprayEconomics } from '@drift/engine'

defineProps<{ econ: SprayEconomics | null; acres: number; status: string | null }>()
const { quality, costPerAcre } = useWhatIf()
const usd = (n: number) => `$${n.toLocaleString('en-US')}`
</script>

<template>
  <div class="cost">
    <template v-if="econ">
      <div class="costrow">
        <div><span class="figure" :class="{ bad: econ.offTargetPct >= 25 }">{{ econ.offTargetPct }}%</span>of the spray would leave the block</div>
        <div><span class="figure" :class="{ bad: econ.offTargetPct >= 25 }">{{ usd(econ.wastedUsd) }}</span>of a {{ usd(econ.costUsd) }} application lost</div>
        <div><span class="figure">+{{ econ.extraPct }}%</span>more product to put the full dose on the trees</div>
      </div>
      <p class="muted">
        {{ econ.offLowPct }}% drifts off near the ground and {{ econ.aloftPct }}% mixes away aloft; {{ econ.landedPct }}% lands in the block.
        <template v-if="status === 'GO'">Some loss is normal even in good conditions.</template>
        <template v-else>The status is {{ status }}: this is what spraying anyway would cost.</template>
      </p>
    </template>
    <div v-else class="muted">Waiting for a reading.</div>
    <div class="row costinputs">
      <label>Cost per acre, $<input v-model.number="costPerAcre" type="number" min="0" step="1"></label>
      <label>Spray quality
        <select v-model="quality"><option value="fine">Fine</option><option value="medium">Medium</option><option value="coarse">Coarse</option></select></label>
    </div>
    <p class="muted">{{ acres }} acres. A model estimate for comparing conditions, not a measurement. $40 per acre is an example; enter your own cost.</p>
  </div>
</template>
