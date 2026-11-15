<script setup lang="ts">
import { ends, type Reading } from '@drift/engine'

const props = defineProps<{ reading: Reading | null; deltaF: number; ri: number; droplet: 'fine' | 'medium' | 'coarse' }>()
const canvas = ref<HTMLCanvasElement | null>(null)
const W = 720, H = 320, GROUND = 280, PX_PER_FT = 6.5
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
  g.font = '13px system-ui, sans-serif'
  if (inverted) {
    g.fillStyle = 'rgba(194,87,26,0.50)'; g.fillRect(0, 0, W, lidY)
    g.fillStyle = 'rgba(31,111,181,0.45)'; g.fillRect(0, lidY, W, GROUND - lidY)
    g.strokeStyle = '#ffd9a8'; g.setLineDash([8, 6]); g.beginPath(); g.moveTo(0, lidY); g.lineTo(W, lidY); g.stroke(); g.setLineDash([])
    g.fillStyle = '#ffe6c7'; g.fillText('warm air above: the lid', 10, lidY - 8)
    g.fillStyle = '#d5ecff'; g.fillText('cool air trapped below', 10, lidY + 18)
  } else {
    g.fillStyle = 'rgba(31,111,181,0.35)'; g.fillRect(0, 0, W, 130)
    g.fillStyle = 'rgba(194,87,26,0.28)'; g.fillRect(0, 130, W, GROUND - 130)
    g.fillStyle = '#d5ecff'; g.fillText('cooler air above, warm air rising from the ground', 10, 20)
  }
  g.fillStyle = '#3b2f22'; g.fillRect(0, GROUND, W, H - GROUND)
  for (let x = 50; x < W; x += 70) {
    if (Math.abs(x - 600) < 30) continue
    g.fillStyle = '#5a3c22'; g.fillRect(x - 2, GROUND - 26, 4, 26)
    g.fillStyle = '#2f7d3a'; g.beginPath(); g.arc(x, GROUND - 48, 26, 0, 6.3); g.fill()
  }
  g.strokeStyle = '#e8edf3'; g.lineWidth = 3; g.beginPath(); g.moveTo(600, GROUND); g.lineTo(600, GROUND - (hi.heightFt + 2) * PX_PER_FT); g.stroke(); g.lineWidth = 1
  for (const [lvl, color] of [[hi, '#ffb066'], [lo, '#8fd0ff']] as const) {
    const y = GROUND - lvl.heightFt * PX_PER_FT
    g.fillStyle = color; g.beginPath(); g.arc(600, y, 5, 0, 6.3); g.fill()
    g.fillStyle = '#fff'; g.font = 'bold 13px system-ui, sans-serif'
    g.fillText(`${lvl.heightFt} ft  ${lvl.tempF.toFixed(1)}°F  ${lvl.windMph} mph ${toward(lvl.windDirDeg) > 0 ? '→' : '←'}`, 612, y + 4 > H - 6 ? H - 6 : y + 4)
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
    <canvas ref="canvas" class="scene" :width="W" :height="H" role="img"
      :aria-label="deltaF > 0 ? 'Side view: spray droplets are trapped under a warm layer and moving sideways' : 'Side view: spray droplets are rising and dispersing'" />
    <div class="muted">Droplets illustrate how spray behaves in these conditions. They are not a prediction of drift distance.</div>
  </div>
</template>
