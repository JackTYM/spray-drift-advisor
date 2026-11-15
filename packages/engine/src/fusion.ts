import { distanceM } from './adapters'
import type { StationObs } from './stations'

/**
 * Estimating the weather at a field that has no station on it.
 *
 * A weather model gives a value everywhere but is coarse and biased. Stations are accurate but sparse.
 * So: at every station, measure how wrong the model is right now; spread those corrections to the
 * field, trusting stations more when they are nearer and at a similar elevation; add the correction
 * to the model's value at the field. This is the idea behind regression kriging, in its simplest form.
 */

export interface ModelNow { tempF: number; windMph: number; windDirDeg: number }
export interface Place { lat: number; lon: number; elevM: number }

/** How wrong the model is at one station: observed minus modelled. Wind is compared as a vector. */
export interface Residual { station: StationObs; model: ModelNow; dTempF: number; du: number; dv: number }
export interface Weighted { id: string; name: string; network: string; lat: number; lon: number; distanceKm: number; dElevM: number; weight: number; dTempF: number; dWindMph: number }

const vec = (mph: number, fromDeg: number): [number, number] => {
  const a = (((fromDeg + 180) % 360) * Math.PI) / 180
  return [mph * Math.sin(a), mph * Math.cos(a)]
}
const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

export function residuals(obs: StationObs[], model: ModelNow[]): Residual[] {
  return obs.map((station, i) => {
    const m = model[i]!
    const [ou, ov] = vec(station.windMph, station.windDirDeg)
    const [mu, mv] = vec(m.windMph, m.windDirDeg)
    return { station, model: m, dTempF: station.tempF - m.tempF, du: ou - mu, dv: ov - mv }
  })
}

/** 100 m of elevation difference counts like this many km of distance: air at another height is different air. */
const KM_PER_100M = 12
/** Stations beyond this effective distance tell us little about the field. */
const RANGE_KM = 60

function rawWeights(target: Place, list: Residual[], skip?: string): { r: Residual; d: number; dz: number; w: number }[] {
  return list.filter(r => r.station.id !== skip).map(r => {
    const d = distanceM(target.lat, target.lon, r.station.lat, r.station.lon) / 1000
    const dz = r.station.elevM - target.elevM
    const eff = Math.hypot(d, (dz / 100) * KM_PER_100M)
    return { r, d, dz, w: 1 / (eff * eff + 4) }
  }).sort((a, b) => b.w - a.w).slice(0, 8)
}

export interface FieldEstimate {
  tempF: number
  windMph: number
  windDirDeg: number
  /** What the stations changed, relative to the model alone. */
  correction: { dTempF: number; dWindMph: number }
  model: ModelNow
  stations: Weighted[]
  /** 0 to 1: how well the nearby stations cover this field. Falls as they get farther or sit at other elevations. */
  support: number
}

export function fuse(target: Place, model: ModelNow, list: Residual[], skip?: string): FieldEstimate {
  const ws = rawWeights(target, list, skip)
  const total = ws.reduce((s, x) => s + x.w, 0) || 1
  // Corrections fade to nothing when every station is far away, so a remote field falls back to the model.
  const nearest = ws.length ? Math.min(...ws.map(x => Math.hypot(x.d, (x.dz / 100) * KM_PER_100M))) : Infinity
  const support = ws.length ? Math.exp(-nearest / RANGE_KM) : 0
  let dT = 0, du = 0, dv = 0
  for (const x of ws) { const k = x.w / total; dT += k * x.r.dTempF; du += k * x.r.du; dv += k * x.r.dv }
  dT *= support; du *= support; dv *= support
  const [mu, mv] = vec(model.windMph, model.windDirDeg)
  const u = mu + du, v = mv + dv
  const windMph = Math.hypot(u, v)
  const windDirDeg = windMph < 0.3 ? model.windDirDeg : (Math.round((Math.atan2(u, v) * 180) / Math.PI + 180) + 360) % 360
  return {
    tempF: r1(model.tempF + dT), windMph: r1(windMph), windDirDeg,
    correction: { dTempF: r1(dT), dWindMph: r1(windMph - model.windMph) }, model, support: r2(support),
    stations: ws.map(x => ({
      id: x.r.station.id, name: x.r.station.name, network: x.r.station.network, lat: x.r.station.lat, lon: x.r.station.lon,
      distanceKm: r1(x.d), dElevM: Math.round(x.dz), weight: r2(x.w / total),
      dTempF: r1(x.r.dTempF), dWindMph: r1(x.r.station.windMph - x.r.model.windMph),
    })),
  }
}

export interface Skill {
  n: number
  /** Mean absolute error of the model alone, and of the station-corrected estimate, at stations held out one at a time. */
  modelTempF: number
  fusedTempF: number
  modelWindMph: number
  fusedWindMph: number
}

/**
 * Accuracy test: hide each station in turn, estimate it from the others, compare with what it read.
 * This is the honest measure of how well the method works where there is no station.
 */
export function leaveOneOut(list: Residual[]): Skill {
  let mt = 0, ft = 0, mw = 0, fw = 0
  for (const r of list) {
    const est = fuse(r.station, r.model, list, r.station.id)
    mt += Math.abs(r.model.tempF - r.station.tempF); ft += Math.abs(est.tempF - r.station.tempF)
    mw += Math.abs(r.model.windMph - r.station.windMph); fw += Math.abs(est.windMph - r.station.windMph)
  }
  const n = list.length || 1
  return { n: list.length, modelTempF: r1(mt / n), fusedTempF: r1(ft / n), modelWindMph: r1(mw / n), fusedWindMph: r1(fw / n) }
}
