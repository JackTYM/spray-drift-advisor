<script setup lang="ts">
import { ends, type Reading, type SensitiveSite } from '@drift/engine'

const props = defineProps<{
  reading: Reading | null
  deltaF: number
  ri: number
  droplet: 'fine' | 'medium' | 'coarse'
  site?: SensitiveSite | null
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const W = 480, H = 330, GROUND = 282, PX_PER_FT = 6.6, TOWER_X = 410, SPRAYER_X = 132
const WARM = [242, 153, 74], COLD = [86, 156, 232]
let frame = 0
let parts: { x: number; y: number; vy: number; age: number }[] = []

const levels = computed(() => {
  if (!props.reading) return []
  const { lo, hi } = ends(props.reading)
  const cls = (mine: number, other: number) => (Math.abs(mine - other) < 0.05 ? '' : mine > other ? 'warmer' : 'cooler')
  return [{ ...hi, cls: cls(hi.tempF, lo.tempF) }, { ...lo, cls: cls(lo.tempF, hi.tempF) }]
})

/** East-west component of where the wind is blowing to: +1 is rightward on screen. */
const toward = (dirDeg: number) => {
  const sx = Math.sin((((dirDeg + 180) % 360) * Math.PI) / 180)
  return Math.abs(sx) < 0.3 ? (sx < 0 ? -0.3 : 0.3) : sx
}
const yFt = (ft: number) => GROUND - ft * PX_PER_FT
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

function drawTree(g: CanvasRenderingContext2D, x: number, s: number) {
  g.fillStyle = '#231a12'
  g.fillRect(x - 3 * s, GROUND - 50 * s, 6 * s, 50 * s)
  g.fillStyle = '#17382a'
  g.beginPath(); g.ellipse(x, GROUND - 78 * s, 30 * s, 44 * s, 0, 0, 6.3); g.fill()
  g.fillStyle = '#1f4a36'
  g.beginPath(); g.ellipse(x - 6 * s, GROUND - 88 * s, 20 * s, 28 * s, 0, 0, 6.3); g.fill()
}

function drawScene(g: CanvasRenderingContext2D, inverted: boolean, lidY: number) {
  const { lo, hi } = ends(props.reading!)

  // Sky, then the air coloured by temperature: amber where it is warmer, blue where it is colder.
  const sky = g.createLinearGradient(0, 0, 0, GROUND)
  sky.addColorStop(0, '#0a1322'); sky.addColorStop(1, '#16263f')
  g.fillStyle = sky; g.fillRect(0, 0, W, H)
  const strength = Math.min(Math.abs(props.deltaF) / 6, 1)
  const air = g.createLinearGradient(0, yFt(hi.heightFt + 6), 0, GROUND)
  const top = inverted ? WARM : COLD, bottom = inverted ? COLD : WARM
  air.addColorStop(0, rgba(top, 0.12 + 0.42 * strength))
  air.addColorStop(inverted ? Math.max((lidY - yFt(hi.heightFt + 6)) / (GROUND - yFt(hi.heightFt + 6)), 0.05) : 0.5, rgba(top, inverted ? 0.1 + 0.3 * strength : 0.06))
  air.addColorStop(1, rgba(bottom, 0.14 + 0.4 * strength))
  g.fillStyle = air; g.fillRect(0, 0, W, GROUND)

  // Santa Rita foothills on the horizon.
  g.fillStyle = '#0c1727'
  g.beginPath(); g.moveTo(0, GROUND)
  for (const [x, y] of [[0, 214], [50, 196], [96, 208], [150, 176], [204, 198], [262, 186], [318, 204], [372, 190], [430, 206], [480, 198], [480, GROUND]] as const) g.lineTo(x, y)
  g.fill()

  if (inverted) {
    g.strokeStyle = rgba(WARM, 0.9); g.lineWidth = 1.5; g.setLineDash([10, 7])
    g.beginPath(); g.moveTo(0, lidY); g.lineTo(W, lidY); g.stroke(); g.setLineDash([]); g.lineWidth = 1
    g.font = '500 13px Barlow, sans-serif'; g.textAlign = 'right'
    g.fillStyle = rgba(WARM, 1); g.fillText('warm air: the lid', W - 10, lidY - 7)
    g.fillStyle = '#a9d2f7'; g.fillText('cold air held below', W - 10, lidY + 17)
    g.textAlign = 'left'
  }

  // Orchard floor and pecan rows.
  g.fillStyle = '#15100b'; g.fillRect(0, GROUND, W, H - GROUND)
  g.fillStyle = '#2a2118'; g.fillRect(0, GROUND, W, 2)
  for (let x = 28; x < W + 30; x += 66) if (Math.abs(x - TOWER_X) > 26) drawTree(g, x, 1)

  // Sensitive site on the side the wind would carry spray toward.
  if (props.site) {
    const bx = Math.sin((props.site.bearingDeg * Math.PI) / 180) >= 0 ? W - 62 : 14
    g.fillStyle = '#d7dee8'
    g.fillRect(bx, GROUND - 26, 48, 26)
    g.beginPath(); g.moveTo(bx - 4, GROUND - 26); g.lineTo(bx + 24, GROUND - 42); g.lineTo(bx + 52, GROUND - 26); g.fill()
    g.fillStyle = '#0d1826'; g.fillRect(bx + 8, GROUND - 18, 8, 8); g.fillRect(bx + 32, GROUND - 18, 8, 8)
  }

  // Airblast sprayer.
  g.fillStyle = '#c9d3df'
  g.fillRect(SPRAYER_X - 34, GROUND - 20, 30, 14); g.fillRect(SPRAYER_X - 18, GROUND - 30, 12, 10)
  g.beginPath(); g.arc(SPRAYER_X + 6, GROUND - 16, 13, 0, 6.3); g.fill()
  g.fillStyle = '#15100b'
  for (const wx of [SPRAYER_X - 28, SPRAYER_X - 8]) { g.beginPath(); g.arc(wx, GROUND - 4, 6, 0, 6.3); g.fill() }

  // Tower with its two sensors.
  g.strokeStyle = '#e9eff6'; g.lineWidth = 2.5
  g.beginPath(); g.moveTo(TOWER_X, GROUND); g.lineTo(TOWER_X, yFt(hi.heightFt + 3)); g.stroke(); g.lineWidth = 1
  g.font = '600 13px Barlow, sans-serif'
  for (const lvl of [hi, lo]) {
    const warmer = lvl === hi ? inverted : !inverted
    g.strokeStyle = '#e9eff6'; g.beginPath(); g.moveTo(TOWER_X - 9, yFt(lvl.heightFt)); g.lineTo(TOWER_X + 9, yFt(lvl.heightFt)); g.stroke()
    g.fillStyle = rgba(warmer ? WARM : [108, 184, 240], 1); g.beginPath(); g.arc(TOWER_X, yFt(lvl.heightFt), 6, 0, 6.3); g.fill()
    g.fillStyle = '#e9eff6'; g.fillText(`${lvl.heightFt} ft`, TOWER_X + 14, yFt(lvl.heightFt) + 4)
  }
}

function tick() {
  const el = canvas.value
  const g = el?.getContext('2d')
  const r = props.reading
  if (!el || !g || !r) { frame = requestAnimationFrame(tick); return }
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  if (el.width !== W * dpr) { el.width = W * dpr; el.height = H * dpr }
  g.setTransform(dpr, 0, 0, dpr, 0, 0)

  const { lo, hi } = ends(r)
  const inverted = props.deltaF > 0
  const lidY = yFt((lo.heightFt + hi.heightFt) / 2 + 5)
  const settle = props.droplet === 'fine' ? 0.05 : props.droplet === 'medium' ? 0.4 : 0.9
  const turb = props.ri > 0.25 ? 0.25 : props.ri > 0 ? 1.1 : 2

  for (let i = 0; i < 4; i++) parts.push({ x: SPRAYER_X + 6 + (Math.random() - 0.5) * 16, y: yFt(4 + Math.random() * 6), vy: -(1.4 + Math.random() * 1.6), age: 0 })
  parts = parts.filter(p => p.x > -10 && p.x < W + 10 && p.y < GROUND && p.age < 900)
  for (const p of parts) {
    const ft = (GROUND - p.y) / PX_PER_FT
    const f = Math.min(Math.max((ft - lo.heightFt) / (hi.heightFt - lo.heightFt), 0), 1.4)
    const wind = lo.windMph * toward(lo.windDirDeg) * (1 - Math.min(f, 1)) + hi.windMph * toward(hi.windDirDeg) * f
    p.x += wind * 0.42 + (Math.random() - 0.5) * turb
    p.vy = p.vy * 0.96 + settle * 0.04
    p.y += p.vy + (Math.random() - 0.5) * turb
    if (inverted && p.y < lidY) { p.y = lidY + Math.random() * 3; p.vy = Math.abs(p.vy) * 0.2 }
    p.age++
  }

  drawScene(g, inverted, lidY)
  g.fillStyle = 'rgba(236,245,255,0.82)'
  const radius = props.droplet === 'fine' ? 1.3 : props.droplet === 'medium' ? 1.9 : 2.5
  for (const p of parts) { g.beginPath(); g.arc(p.x, p.y, radius, 0, 6.3); g.fill() }
  frame = requestAnimationFrame(tick)
}

onMounted(() => { frame = requestAnimationFrame(tick) })
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <div>
    <div class="scene-wrap">
      <canvas ref="canvas" class="scene" :style="{ aspectRatio: `${W} / ${H}` }" role="img"
        :aria-label="deltaF > 0 ? 'Side view of the orchard: spray droplets are trapped under a warm layer and moving sideways' : 'Side view of the orchard: spray droplets are rising and dispersing'" />
      <div class="readouts">
        <div v-for="l in levels" :key="l.heightFt" class="readout" :class="l.cls">
          <span class="h">{{ l.heightFt }} ft</span>
          <span class="t">{{ l.tempF.toFixed(1) }}°F</span>
          <span class="w">{{ l.windMph.toFixed(1) }} mph {{ toward(l.windDirDeg) > 0 ? '→' : '←' }}</span>
        </div>
      </div>
    </div>
    <div class="scene-note">Droplets show how spray behaves in these conditions. They do not predict drift distance.</div>
  </div>
</template>
