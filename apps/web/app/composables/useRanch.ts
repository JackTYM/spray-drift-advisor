import type { Snapshot } from '@drift/engine'

let started = false

/** Live ranch snapshot over WebSocket, with polling as the fallback. */
export function useRanch() {
  const snap = useState<Snapshot | null>('snap', () => null)
  const api = useRuntimeConfig().public.apiBase as string

  if (import.meta.client && !started) {
    started = true
    let timer: ReturnType<typeof setInterval> | undefined
    const poll = async () => {
      try { snap.value = await $fetch<Snapshot>(`${api}/api/blocks`) } catch { /* keep the last snapshot */ }
    }
    const connect = () => {
      const ws = new WebSocket(`${api.replace(/^http/, 'ws')}/api/live`)
      ws.onopen = () => { if (timer) { clearInterval(timer); timer = undefined } }
      ws.onmessage = e => { snap.value = JSON.parse(e.data) }
      ws.onclose = () => {
        timer ??= setInterval(poll, 5000)
        setTimeout(connect, 3000)
      }
    }
    poll()
    connect()
  }
  return { snap, api }
}
