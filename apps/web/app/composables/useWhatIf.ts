import { EXAMPLE_COST_PER_ACRE, WHAT_IF_PRESETS, type Job, type WhatIf } from '@drift/engine'

/**
 * What-if mode: the Now page shows conditions the user chooses instead of the live reading.
 * It lives entirely in the browser, so it never touches the real status, the log or the alerts.
 */
export function useWhatIf() {
  const on = useState('whatif-on', () => false)
  const presetId = useState<string | null>('whatif-preset', () => 'inversion')
  const w = useState<WhatIf>('whatif-w', () => ({ ...WHAT_IF_PRESETS.find(p => p.id === 'inversion')!.w }))
  const quality = useState<Job['droplet']>('spray-quality', () => 'medium')
  const costPerAcre = useState('cost-per-acre', () => EXAMPLE_COST_PER_ACRE)
  function pick(id: string) {
    const p = WHAT_IF_PRESETS.find(x => x.id === id)
    if (!p) return
    presetId.value = id
    w.value = { ...p.w }
  }
  return { on, presetId, w, quality, costPerAcre, pick }
}
