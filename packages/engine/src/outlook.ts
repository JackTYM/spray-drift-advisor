import { ends } from './evaluate'
import type { Weighted } from './fusion'
import { compassOf } from './geo'
import type { PlanHour } from './plan'
import type { Status } from './types'

/** Plain-words answers to the questions an applicator asks about the next hours at one field. */

export interface Outlook {
  decision: 'go' | 'wait' | 'no-window'
  /** The one thing in the way right now, in a farmer's words; null when nothing is. */
  concern: string | null
  trend: 'improving' | 'worsening' | 'steady'
  trendText: string
  checkAgainMs: number
  checkAgainWhy: string
  /** The weakest hour inside the job if it started at the window's start, and what threatens it. */
  duringJob: string
  windAtHeight: string
  sixHour: { timeMs: number; status: Status; confidence: number; text: string } | null
}

interface Win { startMs: number; latestStartMs: number; endMs: number; confidence: number }

const HOUR = 3_600_000
const INVERSION_WORDS = 'warmer air sitting on top of cooler air near the ground, which holds spray low and lets it travel'

const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', hour: 'numeric', minute: '2-digit' })
const dayOf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', year: 'numeric', month: 'numeric', day: 'numeric' })
const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', weekday: 'short' })
const at = (ms: number, nowMs: number) =>
  (dayOf.format(ms) === dayOf.format(nowMs) ? '' : `${weekday.format(ms)} `) + clock.format(ms)

type Kind = 'windLow' | 'windHigh' | 'gust' | 'inversion'
/** How many standard errors each limit is from being broken. Higher is safer. */
const rel = (h: PlanHour): Record<Kind, number> => ({
  windLow: h.margins.windLow / h.margins.sw,
  windHigh: h.margins.windHigh / h.margins.sw,
  gust: h.margins.gust / (h.margins.sw * 1.5),
  inversion: h.margins.inversion / h.margins.sd,
})
const KINDS: Kind[] = ['windLow', 'windHigh', 'gust', 'inversion']
const weakest = (h: PlanHour): [Kind, number] => {
  const r = rel(h)
  return KINDS.map(k => [k, r[k]] as [Kind, number]).sort((a, b) => a[1] - b[1])[0]!
}

function plainReason(text: string): string {
  return /inversion/i.test(text) ? `There is ${INVERSION_WORDS}.` : text
}

function trendOf(hours: PlanHour[]): { trend: Outlook['trend']; trendText: string } {
  const now = hours[0]
  const next = hours.slice(1, 3)
  if (!now || !next.length) return { trend: 'steady', trendText: 'Not enough forecast ahead to say.' }
  const mean = next.reduce((s, h) => s + h.confidence, 0) / next.length
  const diff = mean - now.confidence
  const trend = diff > 0.1 ? 'improving' : diff < -0.1 ? 'worsening' : 'steady'
  if (trend === 'steady') return { trend, trendText: 'Conditions look about the same for the next two hours.' }
  const a = rel(now)
  const b = KINDS.reduce((acc, k) => {
    acc[k] = next.reduce((s, h) => s + rel(h)[k], 0) / next.length
    return acc
  }, {} as Record<Kind, number>)
  // The limit that moves most, in the direction of the overall change.
  const sign = trend === 'improving' ? 1 : -1
  const kind = [...KINDS].sort((x, y) => sign * (b[y] - a[y]) - sign * (b[x] - a[x]))[0]!
  const up = b[kind] > a[kind]
  const text: Record<Kind, [string, string]> = {
    windLow: ['The wind is picking up.', 'The wind is dying down.'],
    windHigh: ['The wind is dying down.', 'The wind is picking up.'],
    gust: ['Gusts are easing off.', 'Gusts are getting stronger.'],
    inversion: ['The air is mixing and the warm layer over the cool air is going away.', 'The air is settling, with warmer air starting to sit over cooler air near the ground.'],
  }
  return { trend, trendText: text[kind][up ? 0 : 1] }
}

function threat(h: PlanHour, kind: Kind, nowMs: number): string {
  const when = at(h.timeMs, nowMs)
  if (kind === 'windLow') return `wind dropping below ${Math.round(h.lowWindMph - h.margins.windLow)} mph around ${when}`
  if (kind === 'windHigh') return `wind rising above ${Math.round(h.highWindMph + h.margins.windHigh)} mph around ${when}`
  if (kind === 'gust') return `gusts above ${Math.round(h.gustMph + h.margins.gust)} mph around ${when}`
  return `warmer air settling over cooler air near the ground around ${when}`
}

function duringJob(hours: PlanHour[], w: Win | null, jobMinutes: number, nowMs: number): string {
  if (!w) return 'No job fits, so nothing to check.'
  const end = w.startMs + jobMinutes * 60_000
  const inside = hours.filter(h => h.timeMs + HOUR > w.startMs && h.timeMs < end)
  if (!inside.length) return 'No forecast hours cover the job.'
  let worst = inside[0]!, worstKind: Kind = 'windLow', worstVal = Infinity
  for (const h of inside) {
    const [k, v] = weakest(h)
    if (v < worstVal) { worst = h; worstKind = k; worstVal = v }
  }
  if (worst.margins.other < 1 && worst.reasons[0] && worstVal > 1.5) return `The risk during the job is this: ${plainReason(worst.reasons[0])}`
  if (worstVal > 2) return `Nothing stands out. The closest call is ${threat(worst, worstKind, nowMs)}, and that is unlikely.`
  return `The risk during the job is ${threat(worst, worstKind, nowMs)}.`
}

function windAtHeight(h: PlanHour | undefined): string {
  if (!h) return 'No forecast to compare.'
  const { lo, hi } = ends(h.reading)
  const a = Math.round(lo.windMph), b = Math.round(hi.windMph)
  const diff = Math.abs(((hi.windDirDeg - lo.windDirDeg + 540) % 360) - 180)
  const speeds = `${a} mph at ${lo.heightFt} ft and ${b} mph at ${hi.heightFt} ft`
  if (diff >= 30) return `Yes. The wind is ${speeds}, and it turns: from the ${compassOf(lo.windDirDeg)} low down and from the ${compassOf(hi.windDirDeg)} higher up.`
  return `${b === a ? 'About the same' : b > a ? 'Faster higher up' : 'Slower higher up'}: ${speeds}, from the ${compassOf(lo.windDirDeg)} at both heights.`
}

export function outlook(hours: PlanHour[], window: Win | null, jobMinutes: number, nowMs: number): Outlook {
  const decision: Outlook['decision'] = !window ? 'no-window' : window.startMs <= nowMs ? 'go' : 'wait'
  const now = hours[0]
  const concern = now?.reasons[0] ? plainReason(now.reasons[0]) : null
  const { trend, trendText } = trendOf(hours)

  const floor = nowMs + 30 * 60_000
  let checkAgainMs: number, checkAgainWhy: string
  if (decision === 'wait') {
    checkAgainMs = Math.max(window!.startMs - HOUR, floor)
    checkAgainWhy = 'The forecast refreshes every hour, so look again just before the window opens.'
  } else if (decision === 'go') {
    checkAgainMs = Math.max(window!.endMs - HOUR, floor)
    checkAgainWhy = 'The forecast refreshes every hour, so look again before the window closes.'
  } else {
    checkAgainMs = nowMs + 3 * HOUR
    checkAgainWhy = 'The forecast refreshes every hour, and nothing is likely to open sooner.'
  }

  let sixHour: Outlook['sixHour'] = null
  if (hours.length) {
    const target = nowMs + 6 * HOUR
    const h = hours.reduce((best, x) => (Math.abs(x.timeMs - target) < Math.abs(best.timeMs - target) ? x : best))
    if (Math.abs(h.timeMs - target) <= 90 * 60_000) {
      const pct = Math.round(h.confidence * 100)
      const text = h.status === 'GO'
        ? `Looks open around ${at(h.timeMs, nowMs)}, about ${pct}% sure.`
        : `Looks closed around ${at(h.timeMs, nowMs)}${h.reasons[0] ? `: ${plainReason(h.reasons[0])}` : '.'}`
      sixHour = { timeMs: h.timeMs, status: h.status, confidence: h.confidence, text }
    }
  }

  return { decision, concern, trend, trendText, checkAgainMs, checkAgainWhy, duringJob: duringJob(hours, window, jobMinutes, nowMs), windAtHeight: windAtHeight(now), sixHour }
}

/** If warm-over-cool air is coming within a day after the given time, a note for products that give off vapor. */
export function vaporNote(hours: PlanHour[], afterMs: number): string | null {
  const h = hours.find(x => x.timeMs > afterMs && x.timeMs <= afterMs + 24 * HOUR && x.margins.inversion < 0)
  if (!h) return null
  return `Spraying may be fine at that time, but still, warm-over-cool air is expected from about ${clock.format(h.timeMs)}. A product that gives off vapor can lift and travel then. Consider a low-volatility formulation.`
}

/** Expected cost of driving out and not being able to finish, in dollars. */
export function tripCost(jobConfidence: number, tripCostUsd: number): number {
  return Math.round((1 - jobConfidence) * tripCostUsd)
}

/** How well one station stands in for the field. */
export function representativeness(s: Weighted): string {
  const word = s.weight >= 0.5 ? 'well' : s.weight >= 0.1 ? 'partly' : 'barely'
  const ft = Math.round(Math.abs(s.dElevM) * 3.281)
  const elev = ft === 0 ? 'the same height' : `${ft} ft ${s.dElevM < 0 ? 'lower' : 'higher'}`
  return `${s.name} stands in for this field ${word}: ${s.distanceKm} km away, ${elev}, ${Math.round(s.weight * 100)}% of the correction.`
}
