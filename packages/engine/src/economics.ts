import { batchDrift } from './drift'
import type { Pt } from './field'
import type { Job, Reading } from './types'

/**
 * Turns the drift model into amounts a grower can weigh: how much of the spray leaves the block,
 * what that costs, and how much extra product it would take to make up for it.
 * These are model estimates for comparing conditions, not measurements.
 */

type Quality = Job['droplet']

/**
 * Assumed share of spray volume in each droplet class for a nozzle's spray quality.
 * A "fine" spray still contains some larger droplets, and a "coarse" one some fines.
 */
export const QUALITY_MIX: Record<Quality, Record<Quality, number>> = {
  fine: { fine: 0.6, medium: 0.3, coarse: 0.1 },
  medium: { fine: 0.2, medium: 0.55, coarse: 0.25 },
  coarse: { fine: 0.05, medium: 0.3, coarse: 0.65 },
}

/** Example product-plus-application cost, dollars per acre. The user replaces it with their own. */
export const EXAMPLE_COST_PER_ACRE = 40

export interface SprayEconomics {
  /** Percent of spray volume that lands in the block. */
  landedPct: number
  /** Percent that leaves the block near the ground, where people and crops are. */
  offLowPct: number
  /** Percent that mixes up and away. */
  aloftPct: number
  /** offLowPct + aloftPct: spray that does not reach the trees. */
  offTargetPct: number
  /** Extra product needed to put the full dose on the trees anyway, as a percent of the planned amount. */
  extraPct: number
  /** Cost of the whole application, and the part of it that leaves the block. */
  costUsd: number
  wastedUsd: number
  /** Fine droplets per 1,000 reaching each receptor, in the order given. */
  perThousand: number[]
}

export function sprayEconomics(reading: Reading, quality: Quality, acres: number, costPerAcre: number, opts: { field?: Pt[]; receptors?: Pt[]; n?: number; steps?: number } = {}): SprayEconomics {
  const { field, receptors = [], n = 150, steps = 500 } = opts
  const mix = QUALITY_MIX[quality]
  let landed = 0, offLow = 0, aloft = 0
  let perThousand: number[] = receptors.map(() => 0)
  for (const cls of ['fine', 'medium', 'coarse'] as const) {
    const r = batchDrift(reading, cls, cls === 'fine' ? receptors : [], { n, steps, field })
    landed += mix[cls] * r.landedPct; offLow += mix[cls] * r.offLowPct; aloft += mix[cls] * r.aloftPct
    if (cls === 'fine') perThousand = r.perThousand
  }
  const r1 = (v: number) => Math.round(v * 10) / 10
  const offTarget = Math.min(offLow + aloft, 99)
  const costUsd = Math.round(acres * costPerAcre)
  return {
    landedPct: r1(landed), offLowPct: r1(offLow), aloftPct: r1(aloft), offTargetPct: r1(offTarget),
    extraPct: Math.round((offTarget / (100 - offTarget)) * 100),
    costUsd, wastedUsd: Math.round((costUsd * offTarget) / 100), perThousand,
  }
}

// ---------- What-if conditions ----------

export interface WhatIf {
  /** Temperature at the upper sensor minus the lower one, °F. Positive is an inversion. */
  deltaF: number
  lowWindMph: number
  highWindMph: number
  /** Direction the wind at the lower sensor blows from. */
  windFromDeg: number
  /** How far the upper wind's direction differs from the lower one. */
  turnDeg: number
  lowTempF: number
}

/** A tower reading for conditions someone wants to try, in the same form as a real one. */
export function whatIfReading(blockId: string, w: WhatIf, timeMs: number): Reading {
  return {
    source: 'what-if', kind: 'modelled', blockId, time: new Date(timeMs).toISOString(),
    levels: [
      { heightFt: 5, tempF: w.lowTempF, windMph: w.lowWindMph, windDirDeg: ((w.windFromDeg % 360) + 360) % 360 },
      { heightFt: 30, tempF: Math.round((w.lowTempF + w.deltaF) * 10) / 10, windMph: w.highWindMph, windDirDeg: (((w.windFromDeg + w.turnDeg) % 360) + 360) % 360 },
    ],
  }
}

export const WHAT_IF_PRESETS: { id: string; name: string; note: string; w: WhatIf }[] = [
  { id: 'ideal', name: 'Good spray morning', note: 'Mixed air, steady light breeze.', w: { deltaF: -1, lowWindMph: 5, highWindMph: 7, windFromDeg: 200, turnDeg: 0, lowTempF: 62 } },
  { id: 'inversion', name: 'Dawn inversion', note: 'Warm air over cold; the ground feels calm and fine.', w: { deltaF: 7, lowWindMph: 3.2, highWindMph: 5, windFromDeg: 190, turnDeg: 10, lowTempF: 46 } },
  { id: 'dead-calm', name: 'Dead calm', note: 'No wind to carry or mix the spray; it hangs and wanders.', w: { deltaF: 3, lowWindMph: 0.8, highWindMph: 1.5, windFromDeg: 190, turnDeg: 30, lowTempF: 48 } },
  { id: 'gusty', name: 'Windy afternoon', note: 'Mixed air, but the wind is over the limit.', w: { deltaF: -1.2, lowWindMph: 11, highWindMph: 16, windFromDeg: 230, turnDeg: 5, lowTempF: 78 } },
  { id: 'toward-homes', name: 'Wind toward the homes', note: 'Legal wind speed, blowing straight at the neighbours.', w: { deltaF: -0.8, lowWindMph: 7, highWindMph: 9, windFromDeg: 185, turnDeg: 0, lowTempF: 66 } },
  { id: 'shear', name: 'Wind changes with height', note: 'Light at the ground, fast and from another direction above the trees.', w: { deltaF: 1.5, lowWindMph: 3.5, highWindMph: 10, windFromDeg: 180, turnDeg: 100, lowTempF: 52 } },
]
