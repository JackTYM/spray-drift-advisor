import type { SprayWindow } from '@drift/engine'

/** Planning texts: about the window ahead, written for someone deciding whether to drive out. Times are ranch local (America/Phoenix). */

const TZ = 'America/Phoenix'
const clock = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' })
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

/** "4:15 PM", with the weekday in front when the day differs from the reference moment's day. */
const label = (ms: number, refMs: number) => {
  const d = new Date(ms)
  const t = clock.format(d)
  return dayKey.format(d) === dayKey.format(new Date(refMs)) ? t : `${weekday.format(d)} ${t}`
}

const pct = (w: SprayWindow) => `${Math.round(w.confidence * 100)}%`

/** The first window as a short text. */
export function planText(fieldName: string, jobMinutes: number, w: SprayWindow | null, nowMs: number): string {
  if (!w) return `${fieldName}: no window for a ${jobMinutes} min job in the next 48 hours.`
  if (w.startMs <= nowMs) {
    const by = w.latestStartMs <= nowMs ? 'Start now' : `Start by ${label(w.latestStartMs, nowMs)}`
    return `${fieldName}: window open now until ${label(w.endMs, nowMs)}. ${by} to finish a ${jobMinutes} min job. Confidence ${pct(w)}.`
  }
  return `${fieldName}: next window ${label(w.startMs, nowMs)} to ${label(w.endMs, w.startMs)}. Start by ${label(w.latestStartMs, w.startMs)}. Confidence ${pct(w)}.`
}

const MOVED_MS = 60 * 60_000

/**
 * A text when the first window appeared, disappeared or moved by an hour or more, otherwise null.
 * prev is undefined on the first observation (no text). A window that has only opened because time passed is not a change.
 */
export function windowChange(fieldName: string, jobMinutes: number, prev: SprayWindow | null | undefined, next: SprayWindow | null, nowMs: number): string | null {
  if (prev === undefined) return null
  // The remembered window is already over: the plan has simply moved on to the next one.
  if (prev && prev.endMs <= nowMs) return null
  if (!prev && !next) return null
  if (!prev && next) return `${fieldName} window opened. ${planText(fieldName, jobMinutes, next, nowMs).slice(fieldName.length + 2)}`
  if (prev && !next) return `${fieldName} window closed. No window for a ${jobMinutes} min job in the next 48 hours.`
  if (!prev || !next) return null
  const a = Math.max(prev.startMs, nowMs), b = Math.max(next.startMs, nowMs)
  if (Math.abs(b - a) < MOVED_MS) return null
  const from = label(prev.startMs, nowMs), to = label(next.startMs, nowMs)
  const by = next.latestStartMs <= nowMs ? 'Start now' : `Start by ${label(next.latestStartMs, nowMs)}`
  return `${fieldName} window moved from ${from} to ${to}. ${by}. Confidence ${pct(next)}.`
}
