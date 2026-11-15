import { DEFAULTS, ends, evaluate, windLimits } from './evaluate'
import { inversionLikely } from './forecast'
import { virtualTower, type Anchor, type BlockModel } from './tower'
import type { Terrain } from './terrain'
import type { Job, Reading, SensitiveSite, Status } from './types'

/**
 * The planner: for one field, which hours ahead are sprayable, how confident we are in each,
 * and which stretches are long enough to finish a whole job, since a custom applicator who has
 * started will not stop.
 */

/** One hour of the regional forecast at the field's location. */
export interface HourModel extends Anchor { gustMph: number; rhPct: number }

/**
 * How the regional profile is turned into a 5 ft / 30 ft tower at this field.
 * Where cold air pools, an inversion needs less regional stability to start and is stronger once it does.
 */
export function towerModelFor(terrain: Terrain): Pick<BlockModel, 'offsetF' | 'factor' | 'turnDeg'> {
  const c = terrain.coldPool
  const high = terrain.kind === 'high ground' ? 3 : 0
  return { offsetF: Math.round((6 * (1 - c) + high) * 10) / 10, factor: Math.round((0.5 + 0.6 * c) * 100) / 100, turnDeg: Math.round(10 + 15 * c) }
}

export interface PlanHour {
  timeMs: number
  status: Status
  /** 0 to 1: confidence that every limit is met this hour, given how wrong the estimate tends to be. */
  confidence: number
  reasons: string[]
  reading: Reading
  /** 30 ft minus 5 ft temperature, °F. */
  deltaF: number
  lowWindMph: number
  highWindMph: number
  gustMph: number
  /**
   * How far each limit is from being broken this hour (positive is safe), and the standard error of each,
   * so an ensemble can perturb them. windLow/windHigh/gust are mph against sw; inversion is °F against sd.
   * other is the 0-1 factor for rules outside wind and inversion (1 when none apply).
   */
  margins: { windLow: number; windHigh: number; gust: number; inversion: number; sw: number; sd: number; other: number }
}

export interface PlanInput {
  id: string
  name: string
  lat: number
  lon: number
  sites: SensitiveSite[]
  terrain: Terrain
  hours: HourModel[]
  nowMs: number
  /** What the stations say the model is getting wrong right now. It fades over the next hours. */
  correction: { dTempF: number; dWindMph: number }
  /** Typical error of the estimate, from the leave-one-station-out test. */
  sigma: { tempF: number; windMph: number }
  /** 0 to 1: how well nearby stations cover the field. */
  support: number
  job?: Job
}

/** Standard normal cumulative distribution (Abramowitz and Stegun 7.1.26). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf)
}

const HOUR = 3_600_000
/** The station correction is about now; it is worth half as much six hours ahead. */
const CORRECTION_HALF_LIFE_H = 6

export function planHours(p: PlanInput): PlanHour[] {
  const model: BlockModel = { id: p.id, name: p.name, crop: '', note: '', lat: p.lat, lon: p.lon, outline: [], sites: p.sites, ...towerModelFor(p.terrain) }
  const lim = windLimits(p.job)
  return p.hours.filter(h => h.timeMs >= p.nowMs - HOUR).map((h, i, all) => {
    const lead = Math.max((h.timeMs - p.nowMs) / HOUR, 0)
    const fade = Math.pow(0.5, lead / CORRECTION_HALF_LIFE_H)
    const windScale = h.wind10Mph > 0.5 ? Math.max(h.wind10Mph + p.correction.dWindMph * fade, 0) / h.wind10Mph : 1
    const anchor: Anchor = {
      ...h, temp2mF: h.temp2mF + p.correction.dTempF * fade, temp80mF: h.temp80mF + p.correction.dTempF * fade,
      wind10Mph: h.wind10Mph * windScale, wind80Mph: h.wind80Mph * windScale,
    }
    const reading = virtualTower(model, anchor, () => 0.5, false, 'modelled', 'field-estimate')
    const next = all[i + 1] ?? h
    const ev = evaluate({ history: [reading], nowMs: h.timeMs, sites: p.sites, job: p.job, inversionLikely: inversionLikely(next) })
    const { lo, hi } = ends(reading)
    const deltaF = Math.round((hi.tempF - lo.tempF) * 10) / 10

    // Uncertainty grows with hours ahead and where stations cover the field poorly.
    // The measured error is for places tens of km from the nearest station: half of it with a station beside the field, half as much again with none in range.
    const grow = (1 + lead / 24) * (1.5 - p.support)
    // The error is in the 33 ft wind; the 5 ft wind is a fraction of it, so its margin is put on the same scale.
    const lowShare = Math.min(Math.max(hi.windMph > 0.5 ? lo.windMph / hi.windMph : 0.7, 0.4), 1)
    const lowMargin = (lo.windMph - lim.min) / lowShare
    const sw = Math.max(p.sigma.windMph, 0.6) * grow
    const sd = Math.max(p.sigma.tempF, 1) * grow
    // The inversion test is made on the regional gradient this field needs before it inverts, where the uncertainty lives.
    const margin = model.offsetF - (anchor.temp80mF - anchor.temp2mF)
    const gust = Math.max(h.gustMph * windScale, hi.windMph)
    let confidence = normalCdf(lowMargin / sw) * normalCdf((lim.max - hi.windMph) / sw) * normalCdf((lim.max * 1.5 - gust) / (sw * 1.5)) * normalCdf(margin / sd)
    // Rules the numbers above do not cover, such as wind toward a sensitive site or strong direction shear.
    const other = ev.triggers.filter(t => !['inversion', 'inversion-forming', 'wind-low', 'wind-high'].includes(t.rule))
    const otherFactor = other.some(t => t.level === 'STOP') ? 0.15 : other.length ? 0.6 : 1
    confidence *= otherFactor

    const reasons = ev.triggers.map(t => t.text)
    if (gust > lim.max * 1.5 && ev.status === 'GO') reasons.push(`Gusts to ${Math.round(gust)} mph are forecast.`)
    return {
      timeMs: h.timeMs, status: ev.status, confidence: Math.round(confidence * 100) / 100, reasons, reading, deltaF,
      lowWindMph: lo.windMph, highWindMph: hi.windMph, gustMph: Math.round(gust * 10) / 10,
      margins: { windLow: lowMargin, windHigh: lim.max - hi.windMph, gust: lim.max * 1.5 - gust, inversion: margin, sw, sd, other: otherFactor },
    }
  })
}

export interface SprayWindow {
  /** The stretch of sprayable hours. */
  startMs: number
  endMs: number
  /** The job must begin by this time to finish inside the window. */
  latestStartMs: number
  minutes: number
  /** The weakest hour's confidence: a window is only as good as its worst hour. */
  confidence: number
}

/** Stretches of consecutive GO hours long enough to finish the job, soonest first. */
export function findWindows(hours: PlanHour[], jobMinutes: number, minConfidence = 0.5): SprayWindow[] {
  const out: SprayWindow[] = []
  let run: PlanHour[] = []
  const close = () => {
    if (run.length) {
      const startMs = run[0]!.timeMs, endMs = run[run.length - 1]!.timeMs + HOUR
      const minutes = (endMs - startMs) / 60_000
      if (minutes >= jobMinutes) out.push({ startMs, endMs, latestStartMs: endMs - jobMinutes * 60_000, minutes, confidence: Math.min(...run.map(h => h.confidence)) })
    }
    run = []
  }
  for (const h of hours) {
    if (h.status === 'GO' && h.confidence >= minConfidence) run.push(h)
    else close()
  }
  close()
  return out
}

/** In words, how sure the estimate is. Based on the accuracy test, not a validated probability. */
export const confidenceWord = (c: number): 'high' | 'moderate' | 'low' => (c >= 0.75 ? 'high' : c >= 0.55 ? 'moderate' : 'low')

export { DEFAULTS as PLAN_DEFAULTS }
