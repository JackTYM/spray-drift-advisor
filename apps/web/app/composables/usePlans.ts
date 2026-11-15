import { BLOCKS, findWindows, type FieldEstimate, type PlanHour, type SensitiveSite, type Skill, type SprayWindow, type StationObs, type Terrain } from '@drift/engine'

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

/** Connor's figure: a custom applicator's job on one field runs about 45 minutes, and is not stopped once started. */
export const DEFAULT_JOB_MIN = 45
const KEY = 'stillair-plan'
let started = false

/** The fields being planned (the ranch's blocks plus any the user adds), their job lengths, and a plan for each. */
export function usePlans() {
  const api = useRuntimeConfig().public.apiBase as string
  const custom = useState<PlanField[]>('plan-custom', () => [])
  const jobMin = useState<Record<string, number>>('plan-job', () => ({}))
  const plans = useState<Record<string, Plan>>('plans', () => ({}))
  const errors = useState<Record<string, string>>('plan-errors', () => ({}))
  const fields = computed<PlanField[]>(() => [...BLOCKS.map(b => ({ id: b.id, name: b.name, lat: b.lat, lon: b.lon })), ...custom.value])
  const minutesFor = (id: string) => jobMin.value[id] ?? DEFAULT_JOB_MIN
  /** Windows are sized to each field's job on this side, so changing the job length needs no new data. */
  const windowsFor = (id: string): SprayWindow[] => (plans.value[id] ? findWindows(plans.value[id]!.hours, minutesFor(id)) : [])

  async function load(f: PlanField) {
    try {
      const plan = await $fetch<Plan>(`${api}/api/plan`, { query: { id: f.id, name: f.name, lat: f.lat, lon: f.lon } })
      plans.value = { ...plans.value, [f.id]: plan }
      const { [f.id]: _gone, ...rest } = errors.value
      errors.value = rest
    } catch (err: any) {
      errors.value = { ...errors.value, [f.id]: err?.data?.error ?? 'The plan could not be loaded.' }
    }
  }
  const refresh = () => Promise.all(fields.value.map(load))
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ custom: custom.value, jobMin: jobMin.value })) } catch { /* private window */ } }

  function addField(lat: number, lon: number): PlanField {
    const n = BLOCKS.length + custom.value.length + 1
    const f: PlanField = { id: `field-${Date.now()}`, name: `Field ${n}`, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, custom: true }
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

  if (import.meta.client && !started) {
    started = true
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
      if (Array.isArray(saved.custom)) custom.value = saved.custom
      if (saved.jobMin) jobMin.value = saved.jobMin
    } catch { /* nothing saved */ }
    refresh()
    setInterval(refresh, 5 * 60_000)
  }
  return { fields, plans, errors, minutesFor, windowsFor, addField, removeField, setMinutes }
}
