/**
 * Application methods an applicator can choose from.
 * The rates and setup times are EXAMPLE starting values only. We have no verified
 * source for them. The user is expected to edit them to match their own equipment.
 */
export interface ApplicationMethod {
  id: 'airplane' | 'helicopter' | 'drone' | 'ground-boom' | 'airblast'
  label: string
  acresPerHour: number
  setupMinutes: number
  releaseHeightFt: number
}

export const APPLICATION_METHODS: ApplicationMethod[] = [
  { id: 'airplane', label: 'Airplane', acresPerHour: 150, setupMinutes: 10, releaseHeightFt: 10 },
  { id: 'helicopter', label: 'Helicopter', acresPerHour: 100, setupMinutes: 10, releaseHeightFt: 10 },
  { id: 'drone', label: 'Drone', acresPerHour: 40, setupMinutes: 15, releaseHeightFt: 8 },
  { id: 'ground-boom', label: 'Ground boom', acresPerHour: 60, setupMinutes: 10, releaseHeightFt: 3 },
  { id: 'airblast', label: 'Airblast (orchard)', acresPerHour: 30, setupMinutes: 5, releaseHeightFt: 6 },
]

/** Job length in minutes: acres / rate x 60 + setup, rounded to the nearest 5 minutes, at least 15. */
export function jobMinutesFor(acres: number, acresPerHour: number, setupMinutes: number): number {
  const raw = (acres / Math.max(acresPerHour, 0.1)) * 60 + Math.max(setupMinutes, 0)
  const rounded = Math.round(raw / 5) * 5
  return Math.max(15, Number.isFinite(rounded) ? rounded : 15)
}
