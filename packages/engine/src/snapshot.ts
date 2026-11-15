import type { SessionState } from './alerts'
import type { Evaluation, GroundObs, Reading, SafeWindow, SensitiveSite, SourceInfo } from './types'

export type Mode = 'live' | 'scenario' | 'replay'
export interface Demo { mode: Mode; scenarioId: string; replayDate: string; stepMin: number; simMs: number }
export interface BlockSnapshot {
  id: string
  name: string
  crop: string
  note: string
  reading: Reading | null
  evaluation: Evaluation | null
  window: SafeWindow | null
  sites: SensitiveSite[]
}
export interface Snapshot {
  nowMs: number
  demo: Demo
  ground: GroundObs | null
  blocks: BlockSnapshot[]
  sessions: SessionState[]
  sources: SourceInfo[]
}
