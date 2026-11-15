import { DEFAULTS } from './evaluate'
import { RANK, worst } from './types'
import type { Evaluation, Status } from './types'

export interface Hysteresis { status: Status; betterSinceMs: number | null; pending: Status | null }

/** Fast to warn, slow to clear. */
export function step(prev: Hysteresis | null, raw: Status, tMs: number, clearMs = DEFAULTS.clearMs): Hysteresis {
  if (!prev || RANK[raw] >= RANK[prev.status]) return { status: raw, betterSinceMs: null, pending: null }
  const since = prev.betterSinceMs ?? tMs
  const pending = prev.pending ? worst(prev.pending, raw) : raw
  if (tMs - since >= clearMs) return { status: pending, betterSinceMs: null, pending: null }
  return { status: prev.status, betterSinceMs: since, pending }
}

export function applyHold(raw: Evaluation, h: Hysteresis): Evaluation {
  if (h.status === raw.status) return raw
  return {
    ...raw,
    status: h.status,
    triggers: [...raw.triggers, { rule: 'holding', level: h.status, text: `Conditions are improving. Holding ${h.status} until they stay better for 10 minutes.` }],
  }
}
