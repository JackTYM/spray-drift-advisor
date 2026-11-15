import type { Anchor } from './tower'

export interface Scenario {
  id: string
  name: string
  startMs: number
  anchors: Anchor[]
  /** Minutes from the start during which one block's tower sends nothing. */
  dropout?: { blockId: string; fromMin: number; toMin: number }
}

type Row = [min: number, temp2mF: number, gradientF: number, wind10Mph: number, dirDeg: number, cloudPct: number, isDay: boolean]

function build(id: string, name: string, startIso: string, rows: Row[], dropout?: Scenario['dropout']): Scenario {
  const startMs = Date.parse(startIso)
  return {
    id, name, startMs, dropout,
    anchors: rows.map(([min, t, g, w, d, c, day]) => ({
      timeMs: startMs + min * 60_000, temp2mF: t, temp80mF: t + g, wind10Mph: w, wind80Mph: w * 1.5,
      dir10Deg: d, dir80Deg: (d + 10) % 360, cloudPct: c, isDay: day,
    })),
  }
}

export const SCENARIOS: Scenario[] = [
  build('dawn-inversion', 'Dawn inversion the ground station misses', '2026-11-17T05:00:00-07:00', [
    [0, 46, 5.5, 6.5, 275, 5, false],
    [90, 45, 8.5, 6.5, 275, 5, false],
    [120, 46, 8.5, 6.5, 275, 5, true],
    [240, 58, -1.4, 6.5, 200, 5, true],
    [600, 72, -1.4, 7.5, 200, 5, true],
  ]),
  build('session-night', 'Inversion forms during a job, clears after sunrise', '2026-11-16T17:30:00-07:00', [
    [0, 66, -1.4, 6, 250, 5, true],
    [60, 60, 2, 5, 250, 5, false],
    [120, 55, 14, 4.5, 250, 5, false],
    [780, 44, 14, 4.5, 250, 5, false],
    [840, 46, 4, 5, 250, 5, true],
    [930, 55, -1.4, 6, 250, 5, true],
    [1200, 70, -1.4, 7, 250, 5, true],
  ]),
  build('windy-afternoon', 'Windy afternoon', '2026-11-17T14:00:00-07:00', [
    [0, 74, -1.4, 14, 230, 20, true],
    [240, 70, -1.4, 13, 230, 20, true],
  ]),
  build('clean-morning', 'Clean spray morning', '2026-11-17T09:00:00-07:00', [
    [0, 58, -1.4, 6.5, 200, 10, true],
    [240, 68, -1.4, 7, 200, 10, true],
  ]),
  build('sensor-dropout', 'Tower stops reporting', '2026-11-17T09:00:00-07:00', [
    [0, 58, -1.4, 6.5, 200, 10, true],
    [240, 68, -1.4, 7, 200, 10, true],
  ], { blockId: 'block-3', fromMin: 10, toMin: 40 }),
]

export const scenarioById = (id: string): Scenario => SCENARIOS.find(s => s.id === id) ?? SCENARIOS[0]
