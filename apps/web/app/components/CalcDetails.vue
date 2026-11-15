<script setup lang="ts">
import { deltaTBand, deltaTC, explain, type GroundObs, type Reading } from '@drift/engine'

const props = defineProps<{ reading: Reading | null; ground: GroundObs | null }>()
const e = computed(() => (props.reading ? explain(props.reading) : null))
const dt = computed(() => (props.ground?.rhPct !== undefined ? deltaTC(props.ground.tempF, props.ground.rhPct) : null))
const band = { humid: 'humid, droplets persist', ideal: 'in the usual 2 to 8 range', dry: 'dry, droplets evaporate fast' }
const v = (u: [number, number]) => `(${u[0].toFixed(2)}, ${u[1].toFixed(2)})`
</script>

<template>
  <div v-if="!e" class="muted">Waiting for a reading.</div>
  <dl v-else class="calc">
    <dt>Temperature gradient</dt>
    <dd>ΔT / Δz = ({{ e.hi.tempF.toFixed(1) }} − {{ e.lo.tempF.toFixed(1) }}) / {{ e.hi.heightFt - e.lo.heightFt }} ft = <b>{{ e.lapsePer100Ft > 0 ? '+' : '' }}{{ e.lapsePer100Ft }} °F per 100 ft</b> ({{ e.deltaF > 0 ? 'inversion' : 'normal cooling with height' }})</dd>
    <dt>Wind vectors</dt>
    <dd>u = speed × (sin θ, cos θ), θ = direction the wind blows to. u<sub>low</sub> = {{ v(e.uLo) }}, u<sub>high</sub> = {{ v(e.uHi) }} mph. |Δu| = <b>{{ e.shearMph }} mph</b> over {{ e.dzM }} m</dd>
    <dt>Potential temperature</dt>
    <dd>Δθ = ΔT + (g / c<sub>p</sub>) Δz = {{ ((e.deltaF * 5) / 9).toFixed(2) }} + {{ (0.0098 * e.dzM).toFixed(2) }} = <b>{{ e.dThetaK.toFixed(2) }} K</b></dd>
    <dt>Bulk Richardson number</dt>
    <dd>Ri = (g / θ)(Δθ Δz) / |Δu|² = (9.81 / {{ e.meanK }})({{ e.dThetaK.toFixed(2) }} × {{ e.dzM }}) / {{ (Math.max(e.shearMph * 0.44704, 0.1)).toFixed(2) }}² = <b>{{ e.ri.toFixed(2) }}</b> ({{ e.ri > 0.25 ? 'above 0.25: stable, no mixing' : e.ri > 0 ? 'below 0.25: weakly stable' : 'negative: unstable, mixing freely' }})</dd>
    <dt>Wind profile</dt>
    <dd>s(z) = s<sub>low</sub> (z / z<sub>low</sub>)<sup>α</sup>, α = <b>{{ e.alpha.toFixed(2) }}</b>, fitted through {{ e.lo.windMph }} mph at {{ e.lo.heightFt }} ft and {{ e.hi.windMph }} mph at {{ e.hi.heightFt }} ft</dd>
    <template v-if="dt !== null && ground">
      <dt>Delta-T</dt>
      <dd>T − T<sub>wet bulb</sub> at the ground station ({{ ground.tempF }}°F, {{ ground.rhPct }}% humidity) = <b>{{ dt }} °C</b> ({{ band[deltaTBand(dt)] }}). Shown for reference; it does not change the status.</dd>
    </template>
  </dl>
</template>
