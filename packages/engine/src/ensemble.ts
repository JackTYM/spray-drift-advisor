import { gaussian } from './drift'
import type { PlanHour, SprayWindow } from './plan'
import { mulberry32 } from './tower'

const HOUR = 3_600_000

export interface EnsembleOpts { n?: number; seed?: number; rho?: number }

/** Per member, per hour: does the wind pass, and does the inversion limit pass. */
interface Members { wind: Uint8Array[]; inv: Uint8Array[] }

const cache = new WeakMap<PlanHour[], Map<string, Members>>()

/** Correlated random errors for every hour (AR(1)), so one bad guess carries into the next hour. */
function members(hours: PlanHour[], o: EnsembleOpts = {}): Members {
  const n = o.n ?? 200, seed = o.seed ?? 20260, rho = o.rho ?? 0.9
  const key = `${n}|${seed}|${rho}`
  let byKey = cache.get(hours)
  if (!byKey) cache.set(hours, (byKey = new Map()))
  const hit = byKey.get(key)
  if (hit) return hit
  const g = gaussian(mulberry32(seed)), k = Math.sqrt(1 - rho * rho)
  const out: Members = { wind: [], inv: [] }
  for (let m = 0; m < n; m++) {
    const wind = new Uint8Array(hours.length), inv = new Uint8Array(hours.length)
    let ew = g(), et = g()
    hours.forEach((h, i) => {
      if (i) { ew = rho * ew + k * g(); et = rho * et + k * g() }
      const mg = h.margins
      wind[i] = mg.windLow + ew * mg.sw >= 0 && mg.windHigh - ew * mg.sw >= 0 && mg.gust - ew * 1.5 * mg.sw >= 0 ? 1 : 0
      inv[i] = mg.inversion - et * mg.sd >= 0 ? 1 : 0
    })
    out.wind.push(wind); out.inv.push(inv)
  }
  byKey.set(key, out)
  return out
}

/** Hour indexes a job starting at startMs touches, or null if it falls outside the plan. */
function span(hours: PlanHour[], startMs: number, jobMinutes: number): [number, number] | null {
  if (!hours.length) return null
  const endMs = startMs + jobMinutes * 60_000
  if (startMs < hours[0]!.timeMs || endMs > hours[hours.length - 1]!.timeMs + HOUR) return null
  let a = -1, b = -1
  hours.forEach((h, i) => { if (h.timeMs < endMs && h.timeMs + HOUR > startMs) { if (a < 0) a = i; b = i } })
  return a < 0 ? null : [a, b]
}

/** Chance the whole job stays within limits: share of ensemble members where every hour passes, times the weakest non-weather factor. */
export function jobConfidence(hours: PlanHour[], startMs: number, jobMinutes: number, opts?: EnsembleOpts): number {
  const s = span(hours, startMs, jobMinutes)
  if (!s) return 0
  const [a, b] = s, ens = members(hours, opts)
  let ok = 0
  for (let m = 0; m < ens.wind.length; m++) {
    let pass = true
    for (let i = a; i <= b && pass; i++) pass = ens.wind[m]![i]! === 1 && ens.inv[m]![i]! === 1
    if (pass) ok++
  }
  let other = 1
  for (let i = a; i <= b; i++) other = Math.min(other, hours[i]!.margins.other)
  return Math.round((ok / ens.wind.length) * other * 100) / 100
}

export interface JobWindow extends SprayWindow {
  /** The start time with the highest chance of finishing clean (earliest on ties). */
  bestStartMs: number
  bestConfidence: number
}

/** Stretches of start times where the whole job fits in GO hours with enough confidence, soonest first. */
export function jobWindows(
  hours: PlanHour[], jobMinutes: number,
  opts: EnsembleOpts & { minConfidence?: number; stepMinutes?: number; nowMs?: number } = {},
): JobWindow[] {
  if (!hours.length) return []
  const step = (opts.stepMinutes ?? 15) * 60_000, min = opts.minConfidence ?? 0.5, jobMs = jobMinutes * 60_000
  const t0 = hours[0]!.timeMs, last = hours[hours.length - 1]!.timeMs + HOUR
  const from = Math.max(opts.nowMs ?? t0, t0)
  const out: JobWindow[] = []
  let run: { t: number; c: number }[] = []
  const close = () => {
    if (run.length) {
      const first = run[0]!, end = run[run.length - 1]!.t + jobMs
      let best = first
      for (const r of run) if (r.c > best.c) best = r
      out.push({ startMs: first.t, endMs: end, latestStartMs: run[run.length - 1]!.t, minutes: (end - first.t) / 60_000, confidence: first.c, bestStartMs: best.t, bestConfidence: best.c })
    }
    run = []
  }
  for (let t = t0 + Math.ceil((from - t0) / step) * step; t + jobMs <= last; t += step) {
    const s = span(hours, t, jobMinutes)
    const c = s ? jobConfidence(hours, t, jobMinutes, opts) : 0
    if (s && c >= min && hours.slice(s[0], s[1] + 1).every(h => h.status === 'GO')) run.push({ t, c })
    else close()
  }
  close()
  return out
}

/** When an expected inversion is likely to clear: 10th, 50th and 90th percentile times. Null if there is none or it rarely clears in the plan. */
export function breakTime(hours: PlanHour[], opts?: EnsembleOpts): { p10Ms: number; p50Ms: number; p90Ms: number } | null {
  const first = hours.findIndex(h => h.margins.inversion < 0)
  if (first < 0) return null
  const { inv } = members(hours, opts)
  const times: number[] = []
  for (const row of inv) {
    for (let j = first + 1; j < hours.length; j++) {
      if (row[j] && (j + 1 >= hours.length || row[j + 1])) { times.push(hours[j]!.timeMs); break }
    }
  }
  if (times.length < inv.length / 2) return null
  times.sort((a, b) => a - b)
  const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!
  return { p10Ms: q(0.1), p50Ms: q(0.5), p90Ms: q(0.9) }
}
