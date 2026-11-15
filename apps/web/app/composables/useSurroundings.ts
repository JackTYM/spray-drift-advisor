import { downwindOf, compassOf, ends, type BlockSnapshot, type Surroundings } from '@drift/engine'

/** Example buffer. The real distance comes from the product label. */
export const BUFFER_M = 300

/** Static facts about what lies around a block, fetched once per block. */
export function useSurroundings(blockId: Ref<string>) {
  const api = useRuntimeConfig().public.apiBase as string
  const cache = useState<Record<string, Surroundings>>('surroundings', () => ({}))
  const load = async (id: string) => {
    if (cache.value[id]) return
    try { cache.value = { ...cache.value, [id]: await $fetch<Surroundings>(`${api}/api/blocks/${id}/surroundings`) } } catch { /* the map still works without it */ }
  }
  if (import.meta.client) watch(blockId, load, { immediate: true })
  return computed(() => cache.value[blockId.value] ?? null)
}

/** What the wind at the lowest level would carry spray toward. */
export function downwindFacts(block: BlockSnapshot | null, s: Surroundings | null) {
  if (!block?.reading || !s) return null
  const { lo } = ends(block.reading)
  const towardDeg = (lo.windDirDeg + 180) % 360
  const dir = compassOf(towardDeg)
  return {
    windFromDeg: lo.windDirDeg,
    towardDeg,
    dir,
    addresses: downwindOf(s.addresses, lo.windDirDeg, BUFFER_M),
    crop: s.crops.find(c => c.dir === dir)?.category ?? null,
    calm: lo.windMph < 1,
  }
}
