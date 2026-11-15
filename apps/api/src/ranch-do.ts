import { DurableObject } from 'cloudflare:workers'
import {
  BLOCKS, RANCH, alertText, alertsFor, applyAlert, applyHold, evaluate, forecastStrip, groundFromAnchor, interpolate, inversionLikely,
  mulberry32, nextSafeWindow, postWatchMs, scenarioById, step, virtualTower,
  type Anchor, type BlockModel, type Demo, type Evaluation, type GroundObs, type Hysteresis, type Job, type Mode, type Reading,
  type SafeWindow, type SensitiveSite, type SessionState, type Snapshot, type SourceInfo,
} from '@drift/engine'
import { sendAlert } from './alerter'
import { db, insertEvaluation, resetLog, upsertSession } from './db'
import type { Env } from './env'
import { blockSites, historyAnchors, historyGround, liveAnchors, liveGround } from './feeds'

const CAP = 100
const LIVE_TICK_MS = 10_000
const DEMO_TICK_MS = 2_000
const clock = new Intl.DateTimeFormat('en-US', { timeZone: RANCH.timeZone, hour: 'numeric', minute: '2-digit' })
const fmt = (ms: number) => clock.format(new Date(ms))

interface BlockState {
  history: Reading[]
  hyst: Hysteresis | null
  evaluation: Evaluation | null
  window: SafeWindow | null
  sites: SensitiveSite[] | null
  externalMs: number
}
interface State {
  blocks: Record<string, BlockState>
  demo: Demo
  sessions: SessionState[]
  anchors: Anchor[]
  ground: GroundObs[]
  fetchedMs: number
}

const freshBlocks = (): Record<string, BlockState> =>
  Object.fromEntries(BLOCKS.map(b => [b.id, { history: [], hyst: null, evaluation: null, window: null, sites: null, externalMs: 0 }]))
const fresh = (): State => ({
  blocks: freshBlocks(),
  demo: { mode: 'live', scenarioId: 'dawn-inversion', replayDate: '', stepMin: 5, simMs: 0 },
  sessions: [], anchors: [], ground: [], fetchedMs: 0,
})

export class RanchDO extends DurableObject<Env> {
  private s!: State
  private rand = mulberry32(42)
  private sql = db(this.env)
  private sitesTriedMs = 0
  /** Last time a client asked for data; ticking continues for a minute after. */
  private seenMs = 0

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get<State>('state')) ?? fresh()
    })
  }

  // ---------- live channel ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 })
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    server.send(JSON.stringify(this.snapshot()))
    await this.wake()
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason)
  }

  private broadcast() {
    const msg = JSON.stringify(this.snapshot())
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg) } catch { /* socket is closing */ }
    }
  }

  private async wake() {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 100)
  }
  private save = () => this.ctx.storage.put('state', this.s)
  private now = () => (this.s.demo.mode === 'live' ? Date.now() : this.s.demo.simMs)

  // ---------- helpers ----------

  private sitesFor(block: BlockModel): SensitiveSite[] {
    const fetched = this.s.blocks[block.id].sites
    return this.s.demo.mode !== 'scenario' && fetched?.length ? fetched : block.sites
  }

  private groundNow(now: number): GroundObs | null {
    if (this.s.demo.mode === 'scenario') {
      return this.s.anchors.length ? groundFromAnchor(interpolate(this.s.anchors, now), RANCH.groundStation) : null
    }
    return this.s.ground.filter(g => g.timeMs <= now).pop() ?? this.s.ground[0] ?? null
  }

  private openSession = (blockId: string) => this.s.sessions.find(x => x.blockId === blockId && x.phase !== 'closed')

  /** Overpass is slow and sometimes down, so sites load in the background and never hold up a tick. */
  private loadSites() {
    const blocks = this.s.blocks
    if (Date.now() - this.sitesTriedMs < 5 * 60_000 || BLOCKS.every(b => blocks[b.id].sites !== null)) return
    this.sitesTriedMs = Date.now()
    this.ctx.waitUntil((async () => {
      for (const b of BLOCKS) if (blocks[b.id].sites === null) blocks[b.id].sites = await blockSites(this.sql, b)
    })())
  }

  // ---------- tick ----------

  async alarm() {
    const d = this.s.demo
    if (d.mode === 'live') {
      if (Date.now() - this.s.fetchedMs > 15 * 60_000 || !this.s.anchors.length) {
        const anchors = await liveAnchors(this.sql)
        if (anchors.length) this.s.anchors = anchors
        const g = await liveGround(this.sql)
        if (g) this.s.ground = [g]
        this.s.fetchedMs = Date.now()
      }
    } else {
      d.simMs += d.stepMin * 60_000
    }
    if (d.mode !== 'scenario') this.loadSites()

    const now = this.now()
    const sc = d.mode === 'scenario' ? scenarioById(d.scenarioId) : null
    const source = d.mode === 'scenario' ? 'scenario' : 'virtual-tower'
    if (this.s.anchors.length) {
      for (const b of BLOCKS) {
        const bs = this.s.blocks[b.id]
        const external = d.mode === 'live' && Date.now() - bs.externalMs < 120_000
        const drop = sc?.dropout && sc.dropout.blockId === b.id && now >= sc.startMs + sc.dropout.fromMin * 60_000 && now < sc.startMs + sc.dropout.toMin * 60_000
        if (external) continue
        const reading = drop ? undefined : virtualTower(b, interpolate(this.s.anchors, now), this.rand, true, 'modelled', source)
        await this.process(b, now, reading)
      }
    }

    await this.save()
    this.broadcast()
    const watching = this.ctx.getWebSockets().length > 0 || this.s.sessions.some(x => x.phase !== 'closed') || Date.now() - this.seenMs < 60_000
    if (watching) await this.ctx.storage.setAlarm(Date.now() + (d.mode === 'live' ? LIVE_TICK_MS : DEMO_TICK_MS))
  }

  private async process(block: BlockModel, now: number, reading: Reading | undefined) {
    const bs = this.s.blocks[block.id]
    if (reading) {
      bs.history.push(reading)
      if (bs.history.length > CAP) bs.history.shift()
    }
    const session = this.openSession(block.id)
    const sites = this.sitesFor(block)
    const anchors = this.s.anchors
    const raw = evaluate({
      history: bs.history, nowMs: now, sites, job: session?.job, ground: this.groundNow(now) ?? undefined,
      inversionLikely: anchors.length ? inversionLikely(interpolate(anchors, now + 3_600_000)) : false,
    })
    const prev = bs.evaluation?.status ?? null
    bs.hyst = step(bs.hyst, raw.status, now)
    const ev = applyHold(raw, bs.hyst)
    bs.evaluation = ev
    bs.window = anchors.length ? nextSafeWindow(block, anchors, now, session?.job, sites) : null

    await insertEvaluation(this.sql, block.id, now, reading, ev, session?.id ?? null).catch(e => console.error('log write failed', e))

    if (!session) return
    if (prev) {
      for (const kind of alertsFor(session, prev, ev.status, bs.window?.startMs ?? null, now)) {
        applyAlert(session, kind)
        const text = alertText(kind, block.name, ev, bs.window?.startMs ?? null, fmt)
        await sendAlert(this.env, this.sql, { kind, blockId: block.id, sessionId: session.id, ...text }).catch(e => console.error('alert failed', e))
      }
    }
    if (session.phase === 'post-watch' && session.finishedMs && now - session.finishedMs >= postWatchMs(session.job)) session.phase = 'closed'
    await upsertSession(this.sql, session).catch(e => console.error('session write failed', e))
  }

  // ---------- RPC: read ----------

  snapshot(): Snapshot {
    const now = this.now()
    const d = this.s.demo
    const lastReading = Math.max(0, ...Object.values(this.s.blocks).map(b => (b.history.length ? Date.parse(b.history[b.history.length - 1].time) : 0)))
    const ground = this.groundNow(now)
    const sources: SourceInfo[] = [
      d.mode === 'scenario'
        ? { role: 'Tower', adapter: 'scenario', kind: 'scripted', detail: scenarioById(d.scenarioId).name, lastMs: lastReading || null }
        : { role: 'Tower', adapter: 'virtual-tower', kind: 'modelled', lastMs: lastReading || null,
            detail: d.mode === 'replay' ? `Open-Meteo historical profile for ${d.replayDate}, scaled to 5 ft and 30 ft` : 'Open-Meteo 2 m and 80 m profile, scaled to 5 ft and 30 ft' },
      ...BLOCKS.filter(b => this.s.blocks[b.id].externalMs > 0).map(b => ({ role: 'Tower', adapter: 'http-ingest', kind: 'measured', detail: `${b.name}: readings posted to /api/readings`, lastMs: this.s.blocks[b.id].externalMs })),
      { role: 'Ground station', adapter: d.mode === 'scenario' ? 'scenario' : 'azmet', kind: d.mode === 'scenario' ? 'scripted' : 'measured', detail: RANCH.groundStationName, lastMs: ground?.timeMs ?? null },
      { role: 'Forecast', adapter: d.mode === 'scenario' ? 'scenario' : 'open-meteo', kind: d.mode === 'scenario' ? 'scripted' : 'modelled', detail: 'Hourly profile used for spray windows', lastMs: this.s.fetchedMs || null },
      { role: 'Sensitive sites', adapter: d.mode === 'scenario' ? 'built-in' : 'overpass', kind: d.mode === 'scenario' ? 'scripted' : 'measured', detail: 'Schools and hospitals within 1.5 km of each block (OpenStreetMap)', lastMs: null },
    ]
    return {
      nowMs: now, demo: d, ground, sessions: this.s.sessions, sources,
      blocks: BLOCKS.map(b => {
        const bs = this.s.blocks[b.id]
        return { id: b.id, name: b.name, crop: b.crop, note: b.note, reading: bs.history[bs.history.length - 1] ?? null, evaluation: bs.evaluation, window: bs.window, sites: this.sitesFor(b) }
      }),
    }
  }

  async getSnapshot(): Promise<Snapshot> {
    this.seenMs = Date.now()
    await this.wake()
    return this.snapshot()
  }

  async forecast(blockId: string) {
    const block = BLOCKS.find(b => b.id === blockId)
    if (!block || !this.s.anchors.length) return []
    return forecastStrip(block, this.s.anchors, this.now(), 12, this.openSession(blockId)?.job, this.sitesFor(block))
  }

  // ---------- RPC: write ----------

  async ingest(reading: Reading): Promise<{ error?: string }> {
    const block = BLOCKS.find(b => b.id === reading.blockId)
    if (!block) return { error: `unknown blockId ${reading.blockId}` }
    this.s.blocks[block.id].externalMs = Date.now()
    await this.process(block, Date.parse(reading.time), reading)
    await this.save()
    this.broadcast()
    return {}
  }

  async setDemo(d: { mode?: Mode; scenarioId?: string; replayDate?: string; stepMin?: number; reset?: boolean }): Promise<Snapshot | { error: string }> {
    const demo = this.s.demo
    const changed = (d.mode !== undefined && d.mode !== demo.mode) || (d.scenarioId !== undefined && d.scenarioId !== demo.scenarioId) || (d.replayDate !== undefined && d.replayDate !== demo.replayDate)
    demo.mode = d.mode ?? demo.mode
    demo.scenarioId = d.scenarioId ?? demo.scenarioId
    demo.replayDate = d.replayDate ?? demo.replayDate
    demo.stepMin = d.stepMin ?? demo.stepMin

    if (changed || d.reset) {
      this.s.blocks = freshBlocks()
      this.s.sessions = []
      this.s.fetchedMs = 0
      this.s.anchors = []
      this.s.ground = []
      if (demo.mode === 'scenario') {
        const sc = scenarioById(demo.scenarioId)
        this.s.anchors = sc.anchors
        demo.simMs = sc.startMs
      }
      if (demo.mode === 'replay') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(demo.replayDate)) return { error: 'replayDate must be YYYY-MM-DD' }
        this.s.anchors = await historyAnchors(this.sql, demo.replayDate)
        this.s.ground = await historyGround(this.sql, demo.replayDate)
        if (!this.s.anchors.length) return { error: `no historical profile for ${demo.replayDate}` }
        demo.simMs = Date.parse(`${demo.replayDate}T17:00:00${RANCH.utcOffset}`)
      }
    }
    if (d.reset) await resetLog(this.sql)
    await this.save()
    this.seenMs = Date.now()
    await this.ctx.storage.setAlarm(Date.now() + 100)
    this.broadcast()
    return this.snapshot()
  }

  async createSession(i: { blockId: string; job: Job; phase: 'waiting' | 'spraying'; overrideReason?: string }): Promise<{ session?: SessionState; error?: string }> {
    const status = this.s.blocks[i.blockId]?.evaluation?.status
    if (!status) return { error: 'No reading for that block yet.' }
    if (this.openSession(i.blockId)) return { error: 'That block already has an open session.' }
    if (i.phase === 'spraying' && status === 'STOP' && !i.overrideReason?.trim()) return { error: 'Status is STOP. Enter a reason to override.' }
    const session: SessionState = {
      id: crypto.randomUUID(), blockId: i.blockId, phase: i.phase, job: i.job, interrupted: i.phase === 'spraying' && status === 'STOP',
      headsUpSent: false, startedMs: this.now(), overrideReason: i.overrideReason?.trim() || undefined,
    }
    this.s.sessions.push(session)
    return this.commit(session)
  }

  async startSession(id: string, overrideReason?: string): Promise<{ session?: SessionState; error?: string }> {
    const session = this.s.sessions.find(x => x.id === id)
    if (!session || session.phase !== 'waiting') return { error: 'No waiting session with that id.' }
    const status = this.s.blocks[session.blockId].evaluation?.status
    if (status === 'STOP' && !overrideReason?.trim()) return { error: 'Status is STOP. Enter a reason to override.' }
    session.phase = 'spraying'
    session.startedMs = this.now()
    session.interrupted = status === 'STOP'
    session.overrideReason = overrideReason?.trim() || undefined
    return this.commit(session)
  }

  async finishSession(id: string): Promise<{ session?: SessionState; error?: string }> {
    const session = this.s.sessions.find(x => x.id === id)
    if (!session || session.phase === 'closed') return { error: 'No open session with that id.' }
    if (session.phase === 'waiting') session.phase = 'closed'
    else { session.phase = 'post-watch'; session.finishedMs = this.now() }
    return this.commit(session)
  }

  private async commit(session: SessionState) {
    await upsertSession(this.sql, session)
    await this.save()
    await this.wake()
    this.broadcast()
    return { session }
  }
}
