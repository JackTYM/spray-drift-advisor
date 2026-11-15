<script setup lang="ts">
import { WHAT_IF_PRESETS } from '@drift/engine'

const { presetId, w, quality, pick } = useWhatIf()
const note = computed(() => WHAT_IF_PRESETS.find(p => p.id === presetId.value)?.note ?? 'Your own conditions.')
const custom = () => { presetId.value = null }
</script>

<template>
  <section class="whatif" aria-label="What-if conditions">
    <div class="whatif-head">
      <strong>What if the conditions were…</strong>
      <span class="muted">Nothing here is live data, and nothing is logged or alerted.</span>
    </div>
    <div class="presets">
      <button v-for="p in WHAT_IF_PRESETS" :key="p.id" :class="{ on: presetId === p.id }" @click="pick(p.id)">{{ p.name }}</button>
    </div>
    <p class="muted" style="margin:6px 0 12px">{{ note }}</p>
    <div class="sliders">
      <label>30 ft compared with 5 ft: <b>{{ w.deltaF > 0 ? '+' : '' }}{{ w.deltaF }}°F</b> {{ w.deltaF > 0 ? '(inversion)' : '' }}
        <input v-model.number="w.deltaF" type="range" min="-3" max="10" step="0.5" @input="custom"></label>
      <label>Wind at 5 ft: <b>{{ w.lowWindMph }} mph</b>
        <input v-model.number="w.lowWindMph" type="range" min="0" max="16" step="0.5" @input="custom"></label>
      <label>Wind at 30 ft: <b>{{ w.highWindMph }} mph</b>
        <input v-model.number="w.highWindMph" type="range" min="0" max="22" step="0.5" @input="custom"></label>
      <label>Wind from the <b>{{ compass(w.windFromDeg) }}</b> ({{ w.windFromDeg }}°)
        <input v-model.number="w.windFromDeg" type="range" min="0" max="355" step="5" @input="custom"></label>
      <label>Direction change with height: <b>{{ w.turnDeg }}°</b>
        <input v-model.number="w.turnDeg" type="range" min="0" max="180" step="5" @input="custom"></label>
      <label>Spray quality
        <select v-model="quality" style="margin:4px 0 0;min-height:40px;padding:6px 36px 6px 10px">
          <option value="fine">Fine</option><option value="medium">Medium</option><option value="coarse">Coarse</option>
        </select></label>
    </div>
  </section>
</template>
