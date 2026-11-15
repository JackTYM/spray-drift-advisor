import { distanceM } from './adapters'

export interface RouteField {
  id: string
  name: string
  lat: number
  lon: number
  jobMinutes: number
  windows: { startMs: number; latestStartMs: number; endMs: number; confidence: number }[]
}
export interface RouteStop {
  id: string
  name: string
  travelMinutes: number
  arriveMs: number
  startMs: number
  finishMs: number
  waitMinutes: number
  confidence: number
}
export interface RouteCosts { crewPerHourUsd: number; fuelPerMileUsd: number; wastedTripUsd: number }
export interface RouteSummary { done: number; finishMs: number | null; driveMinutes: number; waitMinutes: number; driveMiles: number; costUsd: number }
export interface RoutePlan extends RouteSummary {
  stops: RouteStop[]
  deferred: { id: string; name: string; reason: string }[]
  listOrder: RouteSummary
}

const MIN = 60_000
const NO_WINDOW = 'No window in the next 48 hours'
const TOO_LATE = 'Its window closes before the crew is free to get there'

interface Sim extends RouteSummary {
  stops: RouteStop[]
  deferred: { id: string; name: string; reason: string }[]
}

function simulate(order: RouteField[], nowMs: number, travel: (a: { lat: number; lon: number } | null, b: RouteField) => number, speedMph: number, costs: RouteCosts, from?: { lat: number; lon: number }): Sim {
  const stops: RouteStop[] = []
  const deferred: Sim['deferred'] = []
  let pos: { lat: number; lon: number } | null = from ?? null
  let clock = nowMs
  let drive = 0
  let wait = 0
  for (const f of order) {
    const t = travel(pos, f)
    const arrive = clock + t * MIN
    let best: { start: number; conf: number } | null = null
    for (const w of f.windows) {
      const s = Math.max(arrive, w.startMs)
      if (s <= w.latestStartMs && (!best || s < best.start)) best = { start: s, conf: w.confidence }
    }
    if (!best) {
      deferred.push({ id: f.id, name: f.name, reason: f.windows.length === 0 ? NO_WINDOW : TOO_LATE })
      continue
    }
    const finish = best.start + f.jobMinutes * MIN
    // A crew does not sit at a field for hours: when the window is more than two hours off, it sets out later and arrives as it opens.
    const early = (best.start - arrive) / MIN
    const w = early > 120 ? 0 : early
    stops.push({ id: f.id, name: f.name, travelMinutes: t, arriveMs: best.start - w * MIN, startMs: best.start, finishMs: finish, waitMinutes: w, confidence: best.conf })
    drive += t
    wait += w
    clock = finish
    pos = { lat: f.lat, lon: f.lon }
  }
  const miles = (drive / 60) * speedMph
  const cost =
    (drive / 60) * costs.crewPerHourUsd +
    miles * costs.fuelPerMileUsd +
    (wait / 60) * costs.crewPerHourUsd +
    stops.reduce((a, s) => a + (1 - s.confidence) * costs.wastedTripUsd, 0) +
    deferred.length * 0.25 * costs.wastedTripUsd
  return { stops, deferred, done: stops.length, finishMs: stops.length ? clock : null, driveMinutes: drive, waitMinutes: wait, driveMiles: miles, costUsd: cost }
}

function better(a: Sim, b: Sim | null): boolean {
  if (!b) return true
  if (a.done !== b.done) return a.done > b.done
  if (a.costUsd !== b.costUsd) return a.costUsd < b.costUsd
  const fa = a.finishMs ?? Infinity
  const fb = b.finishMs ?? Infinity
  return fa < fb
}

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield items.slice()
    return
  }
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1))
    for (const p of permutations(rest)) yield [items[i], ...p]
  }
}

const summary = (s: Sim): RouteSummary => ({
  done: s.done,
  finishMs: s.finishMs,
  driveMinutes: s.driveMinutes,
  waitMinutes: s.waitMinutes,
  driveMiles: Math.round(s.driveMiles * 10) / 10,
  costUsd: Math.round(s.costUsd),
})

export function planRoute(
  fields: RouteField[],
  opts: { nowMs: number; speedMph?: number; roadFactor?: number; from?: { lat: number; lon: number }; costs?: RouteCosts },
): RoutePlan {
  const costs: RouteCosts = { crewPerHourUsd: 250, fuelPerMileUsd: 0.6, wastedTripUsd: 400, ...opts.costs }
  const speedMph = opts.speedMph && opts.speedMph > 0 ? opts.speedMph : 35
  const roadFactor = opts.roadFactor ?? 1.3
  const travel = (a: { lat: number; lon: number } | null, b: RouteField) => {
    if (!a) return 0
    const miles = (distanceM(a.lat, a.lon, b.lat, b.lon) / 1609.344) * roadFactor
    return (miles / speedMph) * 60
  }
  const run = (order: RouteField[]) => simulate(order, opts.nowMs, travel, speedMph, costs, opts.from)
  const listSim = run(fields)

  let best: Sim | null = null
  if (fields.length <= 7) {
    for (const p of permutations(fields)) {
      const s = run(p)
      if (better(s, best)) best = s
    }
  } else {
    // Nearest-feasible greedy: always go to the closest field that still fits.
    const remaining = fields.slice()
    const order: RouteField[] = []
    let sim = run(order)
    while (remaining.length) {
      let pick: { i: number; t: number } | null = null
      for (let i = 0; i < remaining.length; i++) {
        const s = run([...order, remaining[i]])
        if (s.done === sim.done) continue
        const last = order[order.length - 1]
        const t = travel(last ? last : (opts.from ?? null), remaining[i])
        if (!pick || t < pick.t) pick = { i, t }
      }
      if (!pick) break
      order.push(remaining.splice(pick.i, 1)[0])
      sim = run(order)
    }
    best = run([...order, ...remaining])
  }
  const chosen = best ?? listSim
  return { ...summary(chosen), stops: chosen.stops, deferred: chosen.deferred, listOrder: summary(listSim) }
}
