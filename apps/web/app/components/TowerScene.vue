<script setup lang="ts">
import { ends, type Reading } from '@drift/engine'

const props = defineProps<{ reading: Reading | null; deltaF: number; ri: number; droplet: 'fine' | 'medium' | 'coarse' }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const levels = computed(() => {
  if (!props.reading) return []
  const { lo, hi } = ends(props.reading)
  return [hi, lo]
})
const W = 480, H = 300, GROUND = 262, PX_PER_FT = 6.2, TOWER_X = 425
let frame = 0
let parts: { x: number; y: number; vy: number; age: number }[] = []

/** East-west component of where the wind is blowing to: +1 is rightward. */
const toward = (dirDeg: number) => {
  const sx = Math.sin((((dirDeg + 180) % 360) * Math.PI) / 180)
  return Math.abs(sx) < 0.3 ? (sx < 0 ? -0.3 : 0.3) : sx
}

function tick() {
  const g = canvas.value?.getContext('2d')
  const r = props.reading
  if (!g || !r) { frame = requestAnimationFrame(tick); return }
  const { lo, hi } = ends(r)
  const inverted = props.deltaF > 0
  const lidY = GROUND - ((lo.heightFt + hi.heightFt) / 2 + 4) * PX_PER_FT
  const settle = props.droplet === 'fine' ? 0.05 : props.droplet === 'medium' ? 0.4 : 0.9
  const turb = props.ri > 0.25 ? 0.25 : props.ri > 0 ? 1.2 : 2.2

  for (let i = 0; i < 4; i++) parts.push({ x: W / 2 + (Math.random() - 0.5) * 20, y: GROUND - 55 - Math.random() * 25, vy: -(1.2 + Math.random() * 1.2), age: 0 })
  parts = parts.filter(p => p.x > -10 && p.x < W + 10 && p.y < GROUND && p.age < 900)
  for (const p of parts) {
    const ft = (GROUND - p.y) / PX_PER_FT
    const f = Math.min(Math.max((ft - lo.heightFt) / (hi.heightFt - lo.heightFt), 0), 1.4)
    const wind = lo.windMph * toward(lo.windDirDeg) * (1 - Math.min(f, 1)) + hi.windMph * toward(hi.windDirDeg) * f
    p.x += wind * 0.45 + (Math.random() - 0.5) * turb
    p.vy = p.vy * 0.96 + settle * 0.04
    p.y += p.vy + (Math.random() - 0.5) * turb
    if (inverted && p.y < lidY) { p.y = lidY + Math.random() * 3; p.vy = Math.abs(p.vy) * 0.2 }
    p.age++
  }

  g.fillStyle = '#0f1b2d'; g.fillRect(0, 0, W, H)
  g.font = '15px system-ui, sans-serif'
  if (inverted) {
    g.fillStyle = 'rgba(194,87,26,0.50)'; g.fillRect(0, 0, W, lidY)
    g.fillStyle = 'rgba(31,111,181,0.45)'; g.fillRect(0, lidY, W, GROUND - lidY)
    g.strokeStyle = '#ffd9a8'; g.setLineDash([8, 6]); g.beginPath(); g.moveTo(0, lidY); g.lineTo(W, lidY); g.stroke(); g.setLineDash([])
    g.fillStyle = '#ffe6c7'; g.fillText('warm air above: the lid', 10, lidY - 8)
    g.fillStyle = '#d5ecff'; g.fillText('cool air trapped below', 10, lidY + 18)
  } else {
    g.fillStyle = 'rgba(31,111,181,0.35)'; g.fillRect(0, 0, W, 130)
    g.fillStyle = 'rgba(194,87,26,0.28)'; g.fillRect(0, 130, W, GROUND - 130)
    g.fillStyle = '#d5ecff'; g.fillText('cooler air above, warm air rising', 10, 22)
  }
  g.fillStyle = '#3b2f22'; g.fillRect(0, GROUND, W, H - GROUND)
  for (let x = 40; x < W; x += 62) {
    if (Math.abs(x - TOWER_X) < 30) continue
    g.fillStyle = '#5a3c22'; g.fillRect(x - 2, GROUND - 26, 4, 26)
    g.fillStyle = '#2f7d3a'; g.beginPath(); g.arc(x, GROUND - 48, 26, 0, 6.3); g.fill()
  }
  g.strokeStyle = '#e8edf3'; g.lineWidth = 3; g.beginPath(); g.moveTo(TOWER_X, GROUND); g.lineTo(TOWER_X, GROUND - (hi.heightFt + 2) * PX_PER_FT); g.stroke(); g.lineWidth = 1
  for (const [lvl, color] of [[hi, '#ffb066'], [lo, '#8fd0ff']] as const) {
    const y = GROUND - lvl.heightFt * PX_PER_FT
    g.fillStyle = color; g.beginPath(); g.arc(TOWER_X, y, 6, 0, 6.3); g.fill()
    g.fillStyle = '#fff'; g.font = 'bold 15px system-ui, sans-serif'
    g.fillText(`${lvl.heightFt} ft`, TOWER_X + 10, y + 5)
  }
  g.fillStyle = 'rgba(233,243,255,0.78)'
  const radius = props.droplet === 'fine' ? 1.4 : props.droplet === 'medium' ? 2 : 2.6
  for (const p of parts) { g.beginPath(); g.arc(p.x, p.y, radius, 0, 6.3); g.fill() }
  frame = requestAnimationFrame(tick)
}

onMounted(() => { frame = requestAnimationFrame(tick) })
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <div>
    <div v-for="l in levels" :key="l.heightFt" class="level">
      <strong>{{ l.heightFt }} ft</strong> {{ l.tempF.toFixed(1) }}°F · wind {{ l.windMph }} mph {{ toward(l.windDirDeg) > 0 ? '→' : '←' }}
    </div>
    <canvas ref="canvas" class="scene" :width="W" :height="H" role="img"
      :aria-label="deltaF > 0 ? 'Side view: spray droplets are trapped under a warm layer and moving sideways' : 'Side view: spray droplets are rising and dispersing'" />
    <div class="muted">Droplets illustrate how spray behaves in these conditions. They are not a prediction of drift distance.</div>
  </div>
</template>
