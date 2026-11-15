export type Status = 'GO' | 'CAUTION' | 'STOP'
export const RANK: Record<Status, number> = { GO: 0, CAUTION: 1, STOP: 2 }
export const worst = (a: Status, b: Status): Status => (RANK[a] >= RANK[b] ? a : b)
export const escalate = (s: Status): Status => (s === 'GO' ? 'CAUTION' : 'STOP')

export interface Level { heightFt: number; tempF: number; windMph: number; windDirDeg: number }
export type ReadingKind = 'measured' | 'modelled' | 'recorded'
export interface Reading { source: string; kind: ReadingKind; blockId: string; time: string; levels: Level[] }
export interface GroundObs { station: string; timeMs: number; tempF: number; windMph: number; windDirDeg: number; rhPct?: number }
export interface SensitiveSite { name: string; type: string; bearingDeg: number; distanceM: number }
export interface Job {
  product: string
  volatility: 'low' | 'high'
  droplet: 'fine' | 'medium' | 'coarse'
  labelMinWindMph?: number
  labelMaxWindMph?: number
  // Application details for the spray record. All optional; the applicator fills in what applies.
  applicatorName?: string
  licenseNo?: string
  epaRegNo?: string
  activeIngredient?: string
  ratePerAcre?: string
  targetPest?: string
  /** Hours after application before workers may re-enter. */
  reiHours?: number
  /** The applicator confirmed they checked for schools, homes, workers, water and sensitive crops downwind. */
  sensitiveAreasChecked?: boolean
}
export type RuleId =
  | 'inversion' | 'inversion-forming' | 'wind-low' | 'wind-high'
  | 'speed-shear' | 'direction-shear' | 'sensitive-site' | 'stale-data' | 'holding'
export interface Trigger { rule: RuleId; level: Status; text: string }
export interface EvalInput {
  history: Reading[]
  nowMs: number
  sites: SensitiveSite[]
  job?: Job
  ground?: GroundObs
  inversionLikely?: boolean
}
export interface Evaluation {
  status: Status
  triggers: Trigger[]
  groundOnly: { status: Status; triggers: Trigger[] }
  deltaF: number
  ri: number
}
/** What the tool measured at one moment: saved when a job starts and stops, and when someone holds off. */
export interface Conditions {
  timeMs: number
  status: Status
  groundStatus: Status
  deltaF: number
  ri: number
  levels: Level[]
  ground: GroundObs | null
  reasons: string[]
}

export interface SafeWindow { startMs: number; endMs: number }
export interface SourceInfo { role: string; adapter: string; kind: string; detail: string; lastMs: number | null }
