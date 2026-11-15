import type { Evaluation, Job, Status } from './types'

export type AlertKind = 'stop' | 'heads-up' | 'all-clear'
export type Phase = 'waiting' | 'spraying' | 'post-watch' | 'closed'
export interface SessionState {
  id: string
  blockId: string
  phase: Phase
  job: Job
  interrupted: boolean
  headsUpSent: boolean
  startedMs: number
  finishedMs?: number
  overrideReason?: string
}

export const postWatchMs = (job: Job): number => (job.volatility === 'high' ? 4 * 3_600_000 : 30 * 60_000)

export function alertsFor(s: SessionState, prev: Status, next: Status, windowStartMs: number | null, nowMs: number): AlertKind[] {
  if (s.phase === 'closed') return []
  const out: AlertKind[] = []
  const active = s.phase === 'spraying' || s.phase === 'post-watch'
  const awaitingClear = s.interrupted || s.phase === 'waiting'
  if (active && next === 'STOP' && prev !== 'STOP') out.push('stop')
  if (awaitingClear && next === 'GO' && prev !== 'GO') out.push('all-clear')
  if (awaitingClear && next !== 'GO' && !s.headsUpSent && windowStartMs !== null && windowStartMs > nowMs && windowStartMs - nowMs <= 30 * 60_000) out.push('heads-up')
  return out
}

export function applyAlert(s: SessionState, kind: AlertKind): void {
  if (kind === 'stop') { s.interrupted = true; s.headsUpSent = false }
  if (kind === 'heads-up') s.headsUpSent = true
  if (kind === 'all-clear') { s.interrupted = false; s.headsUpSent = false }
}

export function alertText(kind: AlertKind, blockName: string, ev: Evaluation, windowStartMs: number | null, fmt: (ms: number) => string): { title: string; body: string } {
  if (kind === 'stop') return { title: `STOP spraying: ${blockName}`, body: ev.triggers.map(t => t.text).join(' ') }
  if (kind === 'heads-up') return { title: `${blockName}: window opening soon`, body: `Conditions are expected to be safe from about ${windowStartMs ? fmt(windowStartMs) : 'soon'}. You will get an all-clear when they are.` }
  return { title: `All clear: ${blockName}`, body: 'Conditions have stayed good for 10 minutes. Safe to start or resume. Check the label and the site before spraying.' }
}
