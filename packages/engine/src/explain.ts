import { angleDiff, ends, richardson } from './evaluate'
import type { Level, Reading } from './types'

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)

/** Wet-bulb temperature in °C from air temperature (°C) and relative humidity (%). Stull 2011. */
export function wetBulbC(tC: number, rhPct: number): number {
  const rh = clamp(rhPct, 5, 99)
  return tC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) + Math.atan(tC + rh) - Math.atan(rh - 1.676331)
    + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) - 4.686035
}

/** Delta-T: how far the wet bulb sits below the air temperature, in °C. About 2 to 8 is the usual spraying range. */
export const deltaTC = (tempF: number, rhPct: number): number => {
  const tC = ((tempF - 32) * 5) / 9
  return r1(tC - wetBulbC(tC, rhPct))
}
export const deltaTBand = (dt: number): 'humid' | 'ideal' | 'dry' => (dt < 2 ? 'humid' : dt > 8 ? 'dry' : 'ideal')

/** Wind as an east/north vector in mph, pointing where the air is going. */
export const windVector = (l: Level): [number, number] => {
  const a = (((l.windDirDeg + 180) % 360) * Math.PI) / 180
  return [r2(l.windMph * Math.sin(a)), r2(l.windMph * Math.cos(a))]
}

export interface Explanation {
  lo: Level
  hi: Level
  deltaF: number
  /** Temperature change per 100 ft of height; positive means an inversion. */
  lapsePer100Ft: number
  uLo: [number, number]
  uHi: [number, number]
  /** Size of the vector difference between the two winds, mph. */
  shearMph: number
  turningDeg: number
  dzM: number
  /** Potential temperature difference, K: the temperature difference corrected for height. */
  dThetaK: number
  meanK: number
  ri: number
  /** Exponent of the wind profile s(z) = s_lo (z / z_lo)^alpha. */
  alpha: number
}

export function explain(reading: Reading): Explanation {
  const { lo, hi } = ends(reading)
  const dzFt = hi.heightFt - lo.heightFt
  const dzM = dzFt * 0.3048
  const deltaF = hi.tempF - lo.tempF
  const uLo = windVector(lo)
  const uHi = windVector(hi)
  const alpha = lo.windMph > 0.2 && hi.windMph > 0.2 ? clamp(Math.log(hi.windMph / lo.windMph) / Math.log(hi.heightFt / lo.heightFt), 0, 0.8) : 0.2
  return {
    lo, hi,
    deltaF: r1(deltaF),
    lapsePer100Ft: r1((deltaF / dzFt) * 100),
    uLo, uHi,
    shearMph: r2(Math.hypot(uHi[0] - uLo[0], uHi[1] - uLo[1])),
    turningDeg: Math.round(angleDiff(lo.windDirDeg, hi.windDirDeg)),
    dzM: r1(dzM),
    dThetaK: r2((deltaF * 5) / 9 + 0.0098 * dzM),
    meanK: r1((((lo.tempF + hi.tempF) / 2 - 32) * 5) / 9 + 273.15),
    ri: richardson(lo, hi),
    alpha: r2(alpha),
  }
}

/**
 * Curves for the profile chart, fitted through the two sensors.
 * Temperature follows a log-height fit up to an estimated inversion top, then cools at the dry adiabatic rate.
 * These are estimates between and beyond two points, not measurements.
 */
export function profileCurves(reading: Reading, topFt = 100): { heightFt: number; tempF: number; windMph: number }[] {
  const e = explain(reading)
  const { lo, hi } = e
  const span = Math.log(hi.heightFt / lo.heightFt)
  const invTopFt = e.deltaF > 0 ? clamp(hi.heightFt * (1 + e.deltaF / 5), hi.heightFt, topFt) : hi.heightFt
  const fit = (z: number) => lo.tempF + (e.deltaF * Math.log(z / lo.heightFt)) / span
  const out = []
  for (let z = 2; z <= topFt; z += 2) {
    const tempF = z <= invTopFt ? fit(z) : fit(invTopFt) - 0.0054 * (z - invTopFt)
    out.push({ heightFt: z, tempF: r2(tempF), windMph: r2(lo.windMph * Math.pow(z / lo.heightFt, e.alpha)) })
  }
  return out
}

/** Estimated top of the inversion layer, or null when there is none. */
export function inversionTopFt(reading: Reading, topFt = 100): number | null {
  const e = explain(reading)
  return e.deltaF > 0 ? Math.round(clamp(e.hi.heightFt * (1 + e.deltaF / 5), e.hi.heightFt, topFt)) : null
}
