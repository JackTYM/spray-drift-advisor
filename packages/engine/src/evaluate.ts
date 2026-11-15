import { escalate, worst } from './types'
import type { EvalInput, Evaluation, Job, Level, Reading, Status, Trigger } from './types'

export const DEFAULTS = {
  minWindMph: 3,
  maxWindMph: 10,
  fineMaxWindMph: 8,
  speedShearMph: 5,
  dirShearCautionDeg: 45,
  dirShearStopDeg: 90,
  calmMph: 1,
  formingBandF: 1.0,
  formingRiseF: 0.15,
  formingLookbackMs: 15 * 60_000,
  staleMs: 5 * 60_000,
  siteConeDeg: 45,
  clearMs: 10 * 60_000,
  riCritical: 0.25,
}

export const angleDiff = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}
const r1 = (n: number) => Math.round(n * 10) / 10
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Lowest and highest levels of a reading. */
export const ends = (r: Reading): { lo: Level; hi: Level } => {
  const s = [...r.levels].sort((a, b) => a.heightFt - b.heightFt)
  return { lo: s[0], hi: s[s.length - 1] }
}
export const rawDeltaF = (r: Reading): number => {
  const { lo, hi } = ends(r)
  return hi.tempF - lo.tempF
}

/** Bulk Richardson number between two levels. Above ~0.25 turbulence shuts down. */
export function richardson(lo: Level, hi: Level): number {
  const dz = (hi.heightFt - lo.heightFt) * 0.3048
  const dThetaK = ((hi.tempF - lo.tempF) * 5) / 9 + 0.0098 * dz
  const vec = (l: Level) => {
    const s = l.windMph * 0.44704
    const a = (l.windDirDeg * Math.PI) / 180
    return [-s * Math.sin(a), -s * Math.cos(a)]
  }
  const [u1, v1] = vec(lo)
  const [u2, v2] = vec(hi)
  const dU = Math.max(Math.hypot(u2 - u1, v2 - v1), 0.1)
  const tK = (((lo.tempF + hi.tempF) / 2 - 32) * 5) / 9 + 273.15
  return Math.round(((9.81 / tK) * dThetaK * dz) / (dU * dU) * 100) / 100
}

export const windLimits = (job?: Job) => ({
  min: job?.labelMinWindMph ?? DEFAULTS.minWindMph,
  max: job?.labelMaxWindMph ?? (job?.droplet === 'fine' ? DEFAULTS.fineMaxWindMph : DEFAULTS.maxWindMph),
})

function windTriggers(windMph: number, where: string, lim: { min: number; max: number }): Trigger[] {
  if (windMph < lim.min) return [{ rule: 'wind-low', level: 'CAUTION', text: `Wind ${where} is ${r1(windMph)} mph, below the ${lim.min} mph minimum.` }]
  if (windMph > lim.max) return [{ rule: 'wind-high', level: 'STOP', text: `Wind ${where} is ${r1(windMph)} mph, above the ${lim.max} mph limit.` }]
  return []
}
const statusOf = (ts: Trigger[]): Status => ts.reduce<Status>((s, t) => worst(s, t.level), 'GO')

export function evaluate(input: EvalInput): Evaluation {
  const { history, nowMs, job, sites, ground } = input
  const cur = history[history.length - 1]
  if (!cur || nowMs - Date.parse(cur.time) > DEFAULTS.staleMs) {
    const t: Trigger = { rule: 'stale-data', level: 'CAUTION', text: 'No fresh tower reading in the last 5 minutes. Conditions are unknown.' }
    return { status: 'CAUTION', triggers: [t], groundOnly: { status: 'CAUTION', triggers: [t] }, deltaF: 0, ri: 0 }
  }

  const { lo, hi } = ends(cur)
  const lim = windLimits(job)
  const deltaF = r1(median(history.slice(-3).map(rawDeltaF)))
  const ri = richardson(lo, hi)
  const triggers: Trigger[] = []

  if (deltaF > 0) {
    const mixing = ri > DEFAULTS.riCritical
      ? 'The wind is too light to stir it out, so spray will hang near the ground and travel.'
      : 'Wind is stirring the air, but spray can still be held low and carried.'
    triggers.push({ rule: 'inversion', level: 'STOP', text: `Temperature inversion: air at ${hi.heightFt} ft is ${deltaF}°F warmer than at ${lo.heightFt} ft. ${mixing}` })
  } else {
    const curMs = Date.parse(cur.time)
    const past = [...history].reverse().find(r => curMs - Date.parse(r.time) >= DEFAULTS.formingLookbackMs)
    const rising = past !== undefined && deltaF - rawDeltaF(past) >= DEFAULTS.formingRiseF
    if ((deltaF >= -DEFAULTS.formingBandF && rising) || input.inversionLikely) {
      const level: Status = job?.volatility === 'high' ? 'STOP' : 'CAUTION'
      const why = rising ? 'The temperature gap between heights is closing.' : 'The forecast shows a clear, calm night ahead.'
      triggers.push({ rule: 'inversion-forming', level, text: `An inversion is likely to form soon. ${why}` })
    }
  }

  triggers.push(...windTriggers(lo.windMph, `at ${lo.heightFt} ft`, lim), ...windTriggers(hi.windMph, `at ${hi.heightFt} ft`, lim))

  const speedDiff = Math.abs(hi.windMph - lo.windMph)
  if (speedDiff >= DEFAULTS.speedShearMph) {
    triggers.push({ rule: 'speed-shear', level: 'CAUTION', text: `Wind speed differs by ${r1(speedDiff)} mph between ${lo.heightFt} ft and ${hi.heightFt} ft.` })
  }

  if (lo.windMph >= DEFAULTS.calmMph && hi.windMph >= DEFAULTS.calmMph) {
    const d = Math.round(angleDiff(lo.windDirDeg, hi.windDirDeg))
    if (d >= DEFAULTS.dirShearCautionDeg) {
      triggers.push({ rule: 'direction-shear', level: d >= DEFAULTS.dirShearStopDeg ? 'STOP' : 'CAUTION', text: `Wind direction differs by ${d}° between ${lo.heightFt} ft and ${hi.heightFt} ft.` })
    }
  }

  let status = statusOf(triggers)
  for (const site of sites) {
    const lvl = [lo, hi].find(l => l.windMph >= DEFAULTS.calmMph && angleDiff((l.windDirDeg + 180) % 360, site.bearingDeg) <= DEFAULTS.siteConeDeg)
    if (!lvl) continue
    status = escalate(status)
    triggers.push({ rule: 'sensitive-site', level: status, text: `Wind at ${lvl.heightFt} ft is blowing toward ${site.name}.` })
    break
  }

  const groundTriggers = ground
    ? windTriggers(ground.windMph, `at the ${ground.station} ground station`, lim)
    : windTriggers(lo.windMph, `at ${lo.heightFt} ft`, lim)

  return { status, triggers, groundOnly: { status: statusOf(groundTriggers), triggers: groundTriggers }, deltaF, ri }
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function parseReading(body: unknown): { ok: true; reading: Reading } | { ok: false; error: string } {
  const b = body as Partial<Reading> | null
  if (!b || typeof b !== 'object') return { ok: false, error: 'body must be a JSON object' }
  if (typeof b.blockId !== 'string' || !b.blockId) return { ok: false, error: 'blockId is required' }
  if (typeof b.time !== 'string' || Number.isNaN(Date.parse(b.time))) return { ok: false, error: 'time must be an ISO 8601 timestamp' }
  if (!Array.isArray(b.levels) || b.levels.length < 2) return { ok: false, error: 'levels must contain at least two heights' }
  for (const l of b.levels) {
    if (!num(l.heightFt) || !num(l.tempF) || !num(l.windMph) || !num(l.windDirDeg)) {
      return { ok: false, error: 'each level needs numeric heightFt, tempF, windMph and windDirDeg' }
    }
  }
  const kind = b.kind === 'modelled' || b.kind === 'recorded' ? b.kind : 'measured'
  return { ok: true, reading: { source: typeof b.source === 'string' ? b.source : 'http-ingest', kind, blockId: b.blockId, time: b.time, levels: b.levels } }
}
