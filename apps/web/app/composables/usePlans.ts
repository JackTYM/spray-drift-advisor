import { APPLICATION_METHODS, BLOCKS, jobConfidence, jobWindows, jobMinutesFor, type ApplicationMethod, type FieldEstimate, type PlanHour, type SensitiveSite, type Skill, type JobWindow, type StationObs, type Terrain } from '@drift/engine'

export interface PlanField { id: string; name: string; lat: number; lon: number; custom?: boolean }
export interface Plan {
  field: PlanField
  generatedMs: number
  terrain: Terrain
  estimate: FieldEstimate
  skill: Skill
  sigma: { tempF: number; windMph: number }
  stations: (StationObs & { modelTempF: number; modelWindMph: number })[]
  hours: PlanHour[]
  sites: SensitiveSite[]
}

export interface JobSettings { method: ApplicationMethod['id']; acres: number; acresPerHour: number; setupMinutes: number }

/** Example locations the user can add with one click. */
export const PRESET_FIELDS = [
  { name: 'Yuma Valley vegetables', lat: 32.70, lon: -114.69 },
  { name: 'Willcox Bench orchard', lat: 32.10, lon: -109.72 },
]

/** Connor's figure: a custom applicator's job on one field runs about 45 minutes, and is not stopped once started. */
export const DEFAULT_JOB_MIN = 45
const KEY = 'stillair-plan'
const PLANS_KEY = 'stillair-plans'
let started = false

/** The fields being planned (the ranch's blocks plus any the user adds), their job lengths, and a plan for each. */
export function usePlans() {
  const api = useRuntimeConfig().public.apiBase as string
  const custom = useState<PlanField[]>('plan-custom', () => [])
  const jobMin = useState<Record<string, number>>('plan-job', () => ({}))
  const plans = useState<Record<string, Plan>>('plans', () => ({}))
  const errors = useState<Record<string, string>>('plan-errors', () => ({}))
  const fields = computed<PlanField[]>(() => [...BLOCKS.map(b => ({ id: b.id, name: b.name, lat: b.lat, lon: b.lon })), ...custom.value])
  const jobs = useState<Record<string, Partial<JobSettings>>>('plan-jobs', () => ({}))
  const jobFor = (id: string): JobSettings => {
    const j = jobs.value[id] ?? {}
    const m = APPLICATION_METHODS.find(x => x.id === j.method) ?? APPLICATION_METHODS.find(x => x.id === 'airblast')!
    return { method: m.id, acres: j.acres ?? 20, acresPerHour: j.acresPerHour ?? m.acresPerHour, setupMinutes: j.setupMinutes ?? m.setupMinutes }
  }
  const minutesFor = (id: string) => {
    if (jobMin.value[id] !== undefined) return jobMin.value[id]!
    const j = jobFor(id)
    return jobMinutesFor(j.acres, j.acresPerHour, j.setupMinutes)
  }
  /** Windows are sized to each field's job on this side, so changing the job length needs no new data. */
  const windowsFor = (id: string): JobWindow[] => (plans.value[id] ? jobWindows(plans.value[id]!.hours, minutesFor(id), { nowMs: Date.now() }) : [])

  async function load(f: PlanField) {
    try {
      const plan = await $fetch<Plan>(`${api}/api/plan`, { query: { id: f.id, name: f.name, lat: f.lat, lon: f.lon } })
      plans.value = { ...plans.value, [f.id]: plan }
      try { localStorage.setItem(PLANS_KEY, JSON.stringify(plans.value)) } catch { /* storage full or private window */ }
      const { [f.id]: _gone, ...rest } = errors.value
      errors.value = rest
    } catch (err: any) {
      errors.value = { ...errors.value, [f.id]: err?.data?.error ?? 'The plan could not be loaded.' }
    }
  }
  const refresh = () => Promise.all(fields.value.map(load))
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ custom: custom.value, jobMin: jobMin.value, jobs: jobs.value })) } catch { /* private window */ } }

  function addField(lat: number, lon: number, name?: string): PlanField {
    const n = BLOCKS.length + custom.value.length + 1
    const f: PlanField = { id: `field-${Date.now()}`, name: name || `Field ${n}`, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, custom: true }
    custom.value = [...custom.value, f]
    save()
    load(f)
    return f
  }
  function removeField(id: string) {
    custom.value = custom.value.filter(f => f.id !== id)
    save()
  }
  function setMinutes(id: string, minutes: number) {
    jobMin.value = { ...jobMin.value, [id]: Math.min(Math.max(Math.round(minutes) || DEFAULT_JOB_MIN, 15), 600) }
    save()
  }
  /** Changing the job settings replaces any minutes set directly. */
  function setJob(id: string, partial: Partial<JobSettings>) {
    jobs.value = { ...jobs.value, [id]: { ...jobFor(id), ...partial } }
    const { [id]: _o, ...rest } = jobMin.value
    jobMin.value = rest
    save()
  }

  if (import.meta.client && !started) {
    started = true
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
      if (Array.isArray(saved.custom)) custom.value = saved.custom
      if (saved.jobMin) jobMin.value = saved.jobMin
      if (saved.jobs) jobs.value = saved.jobs
    } catch { /* nothing saved */ }
    // Show the last plans at once, then replace them as fresh ones arrive.
    try {
      const saved = JSON.parse(localStorage.getItem(PLANS_KEY) ?? '{}') as Record<string, Plan>
      const recent = Object.entries(saved).filter(([, p]) => Date.now() - p.generatedMs < 60 * 60_000 && p.hours?.[0]?.margins)
      if (recent.length) plans.value = Object.fromEntries(recent)
    } catch { /* nothing saved */ }
    refresh()
    setInterval(refresh, 5 * 60_000)
  }
  /**
   * When no stretch reaches the confidence bar, the least-bad one: the start with the best chance of finishing,
   * among starts where no hour of the job is a hard stop, and what holds it back.
   */
  function bestChance(id: string): { startMs: number; confidence: number; reason: string } | null {
    const hours = plans.value[id]?.hours ?? []
    const job = minutesFor(id) * 60_000
    let best: { startMs: number; confidence: number; reason: string } | null = null
    for (const h of hours) {
      if (h.timeMs < Date.now() - 15 * 60_000) continue
      const covered = hours.filter(x => x.timeMs + 3_600_000 > h.timeMs && x.timeMs < h.timeMs + job)
      // Never offer an hour with a hard stop, or one whose wind blows toward buildings or another sensitive site.
      if (!covered.length || covered.some(x => x.status === 'STOP' || x.margins.other < 1)) continue
      const confidence = jobConfidence(hours, h.timeMs, minutesFor(id))
      if (confidence > (best?.confidence ?? 0.09)) {
        const weakest = [...covered].sort((a, b) => a.confidence - b.confidence)[0]!
        best = { startMs: h.timeMs, confidence, reason: weakest.reasons[0] ?? 'Wind is forecast close to a limit, so a small change would close it.' }
      }
    }
    return best
  }

  return { bestChance, fields, plans, errors, minutesFor, windowsFor, addField, removeField, setMinutes, jobFor, setJob, PRESET_FIELDS }
}
