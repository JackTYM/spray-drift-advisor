import { Hono } from 'hono'
import { cors } from 'hono/cors'
import Anthropic from '@anthropic-ai/sdk'
import { BLOCKS, EXAMPLE_COST_PER_ACRE, RANCH, areaAcres, compassOf, ends, localOutline, sprayEconomics, type Conditions, type SessionState, parseReading, readingsFromCsv, summarize, type CsvMapping, type Snapshot } from '@drift/engine'
import { ask, readLabel } from './ai'
import { alertPhones, sendLinq } from './alerter'
import { evaluationNear, insertAlert, upsertSession, sessionStats, alertRows, db, insertRecorded, latestBacktest, logRows, saveSubscription, sessionById, sessionRows } from './db'
import type { Env } from './env'
import { blockSurroundings } from './feeds'
import { cachedPlan } from './plan'
import { planText } from './plan-alerts'

export { RanchDO } from './ranch-do'

const app = new Hono<{ Bindings: Env }>()
app.use('/api/*', cors())
const ranch = (env: Env) => env.RANCH.getByName('ranch-1')
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

app.get('/api/blocks', async c => c.json(await ranch(c.env).getSnapshot()))
app.get('/api/sources', async c => c.json((await ranch(c.env).getSnapshot()).sources))

app.post('/api/readings', async c => {
  const parsed = parseReading(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  const r = await ranch(c.env).ingest(parsed.reading)
  return r.error ? c.json(r, 400) : c.json({ ok: true })
})

app.post('/api/import/csv', async c => {
  const body = await c.req.json<{ csv: string; mapping: CsvMapping }>().catch(() => null)
  if (!body?.csv || !body.mapping?.levels?.length) return c.json({ error: 'csv and mapping are required' }, 400)
  const { readings, errors } = readingsFromCsv(body.csv, body.mapping)
  if (readings.length) await insertRecorded(db(c.env), body.mapping.source, body.mapping.blockId, readings)
  return c.json({ imported: readings.length, errors, summary: summarize(readings) })
})

app.get('/api/blocks/:id/history', async c => {
  const rows = await logRows(db(c.env), c.req.param('id'), null, 240)
  return c.json({ history: rows.reverse(), forecast: await ranch(c.env).forecast(c.req.param('id')) })
})

app.get('/api/blocks/:id/surroundings', async c => {
  const block = BLOCKS.find(b => b.id === c.req.param('id'))
  if (!block) return c.json({ error: 'unknown block' }, 404)
  return c.json(await blockSurroundings(db(c.env), block))
})

app.get('/api/log', async c => {
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 1000)
  return c.json(await logRows(db(c.env), c.req.query('block') ?? null, null, limit))
})

app.get('/api/sessions', async c => c.json((await sessionRows(db(c.env), 20)).map(r => r.state)))
app.post('/api/sessions', async c => c.json(await ranch(c.env).createSession(await c.req.json())))
app.post('/api/sessions/:id/start', async c => {
  const body = await c.req.json<{ overrideReason?: string }>().catch(() => ({} as { overrideReason?: string }))
  return c.json(await ranch(c.env).startSession(c.req.param('id'), body.overrideReason))
})
app.post('/api/sessions/:id/finish', async c => c.json(await ranch(c.env).finishSession(c.req.param('id'))))

app.get('/api/sessions/:id/record', async c => {
  const sql = db(c.env)
  const id = c.req.param('id')
  const session = await sessionById(sql, id)
  if (!session) return c.json({ error: 'not found' }, 404)
  const evaluations = (await logRows(sql, null, id, 5000)).reverse()
  const alerts = (await alertRows(sql, id, 200)).reverse()
  if (c.req.query('format') !== 'csv') return c.json({ session, evaluations, alerts })
  const lines = [
    ['time', 'block', 'status', 'ground_station_only', 'temp_difference_f', 'richardson', 'triggers', 'levels'].join(','),
    ...evaluations.map(e => [e.time, e.block_id, e.status, e.ground_status, e.delta_f, e.ri,
      (e.triggers as { text: string }[]).map(t => t.text).join(' | '), JSON.stringify(e.levels ?? [])].map(csvCell).join(',')),
  ]
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="spray-record-${id}.csv"` } })
})

// ---------- Spray log: one row per job or decision not to spray ----------

const WORST = ['GO', 'CAUTION', 'STOP']
const stamp = new Intl.DateTimeFormat('en-US', { timeZone: RANCH.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const when = (ms?: number) => (ms ? stamp.format(new Date(ms)) : '')
const weather = (c?: Conditions) => (c ? {
  status: c.status, groundOnly: c.groundStatus, tempDiffF: c.deltaF, richardson: c.ri,
  low: c.levels[0] ? `${c.levels[0].heightFt} ft: ${c.levels[0].tempF}°F, ${c.levels[0].windMph} mph from ${compassOf(c.levels[0].windDirDeg)}` : '',
  high: c.levels[1] ? `${c.levels[1].heightFt} ft: ${c.levels[1].tempF}°F, ${c.levels[1].windMph} mph from ${compassOf(c.levels[1].windDirDeg)}` : '',
  inversion: c.deltaF > 0 ? 'Yes' : 'No', reasons: c.reasons.join(' '),
} : null)

async function sprayLog(env: Env) {
  const sql = db(env)
  const [sessions, stats] = await Promise.all([sessionRows(sql, 500), sessionStats(sql)])
  const bySession = new Map(stats.map(r => [r.session_id as string, r]))
  return sessions.map(r => r.state as SessionState).map(s => {
    const block = BLOCKS.find(b => b.id === s.blockId)
    const st = bySession.get(s.id)
    return {
      id: s.id, outcome: s.outcome ?? (s.phase === 'waiting' ? 'waiting' : 'sprayed'), phase: s.phase,
      block: block?.name ?? s.blockId, crop: block?.crop ?? '', acres: block ? areaAcres(localOutline(block)) : null,
      lat: block?.lat ?? null, lon: block?.lon ?? null,
      started: when(s.startedMs), stopped: s.outcome === 'not-sprayed' ? '' : when(s.finishedMs),
      minutes: s.outcome !== 'not-sprayed' && s.finishedMs ? Math.round((s.finishedMs - s.startedMs) / 60000) : null,
      reentryAllowed: s.outcome !== 'not-sprayed' && s.finishedMs && s.job.reiHours ? when(s.finishedMs + s.job.reiHours * 3_600_000) : '',
      job: s.job, overrideReason: s.overrideReason ?? '', holdReason: s.holdReason ?? '', enteredLater: s.enteredLater ?? false,
      atStart: weather(s.startConditions), atStop: weather(s.stopConditions),
      worstDuring: st ? WORST[Number(st.worst)] : '', evaluations: st ? Number(st.evaluations) : 0, alerts: st ? Number(st.alerts) : 0,
    }
  })
}

/** Conditions the tower logged around a past moment, for a record entered afterwards. */
async function conditionsAt(env: Env, blockId: string, timeMs: number): Promise<Conditions | undefined> {
  const row = await evaluationNear(db(env), blockId, new Date(timeMs).toISOString())
  if (!row) return undefined
  const levels = [...(row.levels as Conditions['levels'])].sort((a, b) => a.heightFt - b.heightFt)
  return {
    timeMs: Date.parse(row.time as string), status: row.status as Conditions['status'], groundStatus: row.ground_status as Conditions['status'],
    deltaF: Number(row.delta_f), ri: Number(row.ri), levels: [levels[0]!, levels[levels.length - 1]!], ground: null,
    reasons: (row.triggers as { text: string }[]).map(t => t.text),
  }
}

// A record typed in afterwards: a spray that was not logged as it ran, or a decision not to spray.
app.post('/api/spraylog', async c => {
  const b = await c.req.json<{ blockId?: string; outcome?: string; startedMs?: number; finishedMs?: number; job?: SessionState['job']; holdReason?: string }>().catch(() => null)
  const block = BLOCKS.find(x => x.id === b?.blockId)
  if (!b || !block) return c.json({ error: 'Choose a block.' }, 400)
  if (!b.job?.product?.trim()) return c.json({ error: 'Enter the product.' }, 400)
  if (!b.startedMs || Number.isNaN(b.startedMs)) return c.json({ error: 'Enter the date and time.' }, 400)
  if (b.startedMs > Date.now() + 60_000) return c.json({ error: 'The start time is in the future.' }, 400)
  const sprayed = b.outcome !== 'not-sprayed'
  if (sprayed && (!b.finishedMs || b.finishedMs <= b.startedMs)) return c.json({ error: 'Enter a stop time after the start time.' }, 400)
  const session: SessionState = {
    id: crypto.randomUUID(), blockId: block.id, phase: 'closed', job: b.job, interrupted: false, headsUpSent: false, enteredLater: true,
    startedMs: b.startedMs, finishedMs: sprayed ? b.finishedMs : b.startedMs, outcome: sprayed ? 'sprayed' : 'not-sprayed',
    holdReason: b.holdReason?.trim() || undefined,
    startConditions: await conditionsAt(c.env, block.id, b.startedMs),
    stopConditions: sprayed ? await conditionsAt(c.env, block.id, b.finishedMs!) : undefined,
  }
  await upsertSession(db(c.env), session)
  return c.json({ session })
})

app.get('/api/spraylog', async c => {
  const rows = await sprayLog(c.env)
  if (c.req.query('format') !== 'csv') return c.json(rows)
  const cols: [string, (r: (typeof rows)[number]) => unknown][] = [
    ['Outcome', r => (r.outcome === 'not-sprayed' ? 'Did not spray' : r.outcome === 'waiting' ? 'Waiting' : 'Sprayed')],
    ['Block', r => r.block], ['Crop', r => r.crop], ['Acres', r => r.acres], ['Latitude', r => r.lat], ['Longitude', r => r.lon],
    ['Started (local)', r => r.started], ['Stopped (local)', r => r.stopped], ['Minutes', r => r.minutes],
    ['Applicator', r => r.job.applicatorName], ['License or certificate no.', r => r.job.licenseNo],
    ['Product', r => r.job.product], ['EPA Reg. No.', r => r.job.epaRegNo], ['Active ingredient', r => r.job.activeIngredient],
    ['Rate per acre', r => r.job.ratePerAcre], ['Target pest', r => r.job.targetPest], ['Droplet size', r => r.job.droplet],
    ['Re-entry interval (h)', r => r.job.reiHours], ['Re-entry allowed from (local)', r => r.reentryAllowed],
    ['Downwind sensitive areas checked', r => (r.job.sensitiveAreasChecked ? 'Yes' : 'Not recorded')],
    ['Status at start', r => r.atStart?.status], ['Ground station only at start', r => r.atStart?.groundOnly], ['Inversion at start', r => r.atStart?.inversion],
    ['Temp difference at start (F)', r => r.atStart?.tempDiffF], ['Richardson no. at start', r => r.atStart?.richardson],
    ['Lower sensor at start', r => r.atStart?.low], ['Upper sensor at start', r => r.atStart?.high], ['Reasons at start', r => r.atStart?.reasons],
    ['Status at stop', r => r.atStop?.status], ['Inversion at stop', r => r.atStop?.inversion], ['Temp difference at stop (F)', r => r.atStop?.tempDiffF],
    ['Lower sensor at stop', r => r.atStop?.low], ['Upper sensor at stop', r => r.atStop?.high],
    ['Worst status during job', r => r.worstDuring], ['Evaluations logged', r => r.evaluations], ['Alerts sent', r => r.alerts],
    ['Override reason', r => r.overrideReason], ['Reason for not spraying', r => r.holdReason],
    ['How it was recorded', r => (r.enteredLater ? 'Entered afterwards' : 'Logged as it happened')], ['Record ID', r => r.id],
  ]
  const csv = [cols.map(c2 => csvCell(c2[0])).join(','), ...rows.map(r => cols.map(c2 => csvCell(c2[1](r))).join(','))].join('\n')
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="stillair-spray-log.csv"' } })
})

/** The window plan for any field: /api/plan?lat=..&lon=..&jobMin=45&name=.. */
app.get('/api/plan', async c => {
  const lat = Number(c.req.query('lat')), lon = Number(c.req.query('lon'))
  if (!(lat > 24 && lat < 50 && lon > -125 && lon < -66)) return c.json({ error: 'Give a latitude and longitude inside the continental United States.' }, 400)
  const jobMinutes = Math.min(Math.max(Number(c.req.query('jobMin')) || 45, 15), 600)
  const plan = await cachedPlan(db(c.env), { id: c.req.query('id') ?? 'field', name: c.req.query('name') ?? 'Field', lat, lon }, jobMinutes, p => c.executionCtx.waitUntil(p), c.req.query('example') === '1')
  return c.json(plan, 'error' in plan ? 502 : 200)
})

/** Texts the first window of a field's plan to every alert phone: POST { id, name, lat, lon, jobMinutes }. */
app.post('/api/plan/text', async c => {
  const b = await c.req.json<{ id?: string; name?: string; lat?: number; lon?: number; jobMinutes?: number }>().catch(() => null)
  const lat = Number(b?.lat), lon = Number(b?.lon)
  if (!(lat > 24 && lat < 50 && lon > -125 && lon < -66)) return c.json({ error: 'Give a latitude and longitude inside the continental United States.' }, 400)
  const jobMinutes = Math.min(Math.max(Number(b?.jobMinutes) || 45, 15), 600)
  const field = { id: String(b?.id ?? 'field'), name: String(b?.name ?? 'Field').slice(0, 80), lat, lon }
  const sql = db(c.env)
  // The same plan and the same whole-job windows the page shows.
  const plan = await cachedPlan(sql, field, jobMinutes, p => c.executionCtx.waitUntil(p))
  if ('error' in plan) return c.json({ sent: 0, text: '', error: plan.error }, 502)
  const text = planText(field.name, jobMinutes, plan.windows[0] ?? null, Date.now())
  const phones = alertPhones(c.env)
  if (!c.env.LINQ_API_KEY || !phones.length) return c.json({ sent: 0, text, error: 'Texting is not set up on this server.' })
  let sent = 0
  for (const phone of phones) {
    const r = await sendLinq(c.env, phone, text)
    if (r.ok) sent++
    await insertAlert(sql, { sessionId: null, blockId: field.id, kind: 'plan', channel: 'imessage', recipient: phone, ...r, title: `${field.name} plan`, body: text }).catch(e => console.error('alert record failed', e))
  }
  return c.json(sent ? { sent, text } : { sent, text, error: 'The text could not be delivered.' })
})

app.get('/api/alerts', async c => c.json(await alertRows(db(c.env), null, 30)))
app.get('/api/backtest', async c => c.json(await latestBacktest(db(c.env))))

app.post('/api/push/subscribe', async c => {
  const body = await c.req.json<{ role: string; subscription: { endpoint: string } }>().catch(() => null)
  if (!body?.subscription?.endpoint) return c.json({ error: 'subscription is required' }, 400)
  await saveSubscription(db(c.env), body.role ?? 'applicator', body.subscription)
  return c.json({ ok: true })
})

// ---------- Claude: label reader and questions ----------

const clock = new Intl.DateTimeFormat('en-US', { timeZone: RANCH.timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const hm = new Intl.DateTimeFormat('en-US', { timeZone: RANCH.timeZone, hour: 'numeric', minute: '2-digit' })
const at = (ms: number) => hm.format(new Date(ms))

/** Everything the tool knows right now, as plain text. This is the only material Claude answers from. */
async function snapshotText(env: Env): Promise<string> {
  const stub = ranch(env)
  const s: Snapshot = await stub.getSnapshot()
  const lines = [
    `Time now at the orchard: ${clock.format(new Date(s.nowMs))} (${RANCH.timeZone}). Data mode: ${s.demo.mode}.`,
    s.ground ? `Ground station ${s.ground.station}: ${s.ground.tempF}°F, wind ${s.ground.windMph} mph from the ${compassOf(s.ground.windDirDeg)}${s.ground.rhPct !== undefined ? `, humidity ${s.ground.rhPct}%` : ''}.` : 'Ground station: no reading.',
  ]
  for (const b of s.blocks) {
    const ev = b.evaluation
    lines.push('', `${b.name} (${b.note}): status ${ev?.status ?? 'unknown, no reading yet'}.${ev ? ` A ground station alone would say ${ev.groundOnly.status}.` : ''}`)
    if (ev) lines.push(`  Reasons: ${ev.triggers.map(t => t.text).join(' ') || 'none; no inversion and wind within limits.'}`)
    if (b.reading && ev) {
      const { lo, hi } = ends(b.reading)
      lines.push(`  ${lo.heightFt} ft: ${lo.tempF}°F, wind ${lo.windMph} mph from the ${compassOf(lo.windDirDeg)}. ${hi.heightFt} ft: ${hi.tempF}°F, wind ${hi.windMph} mph from the ${compassOf(hi.windDirDeg)}. Temperature difference ${ev.deltaF > 0 ? '+' : ''}${ev.deltaF}°F. Richardson number ${ev.ri}.`)
    }
    const model = BLOCKS.find(x => x.id === b.id)
    if (b.reading && model) {
      // A small run of the drift model, so the assistant can say what spraying now would cost.
      const field = localOutline(model)
      const acres = areaAcres(field)
      const e = sprayEconomics(b.reading, 'medium', acres, EXAMPLE_COST_PER_ACRE, { field, n: 40, steps: 250 })
      lines.push(`  Drift model estimate if sprayed now (${acres} acres, medium spray quality, example cost of ${EXAMPLE_COST_PER_ACRE} dollars per acre): about ${Math.round(e.offTargetPct)}% of the spray would leave the block, about ${e.wastedUsd} dollars of a ${e.costUsd} dollar application; ${e.extraPct}% more product would be needed to put the full dose on the trees.`)
    }
    lines.push(`  Next safe window: ${ev?.status === 'GO' ? 'open now' : b.window ? `${at(b.window.startMs)} to ${at(b.window.endMs)}` : 'none in the next 36 hours'}.`)
    const forecast = await stub.forecast(b.id)
    if (forecast.length) lines.push(`  Forecast: ${forecast.slice(0, 24).map(f => `${at(f.timeMs)} ${f.status}`).join(', ')}.`)
    if (b.sites.length) lines.push(`  Sensitive sites nearby: ${b.sites.slice(0, 4).map(x => `${x.name} (${x.distanceM} m to the ${compassOf(x.bearingDeg)})`).join('; ')}.`)
  }
  const open = s.sessions.filter(x => x.phase !== 'closed')
  lines.push('', open.length
    ? `Open spray jobs: ${open.map(x => `${BLOCKS.find(b => b.id === x.blockId)?.name ?? x.blockId}: ${x.phase}, ${x.job.product}, ${x.job.droplet} droplets, since ${at(x.startedMs)}`).join('; ')}.`
    : 'Open spray jobs: none.')
  return lines.join('\n')
}

/** Claude failures never break the app: the caller gets a plain message and the status screen still works. */
function aiError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return 'The assistant is busy. Try again in a minute.'
  if (err instanceof Anthropic.AuthenticationError) return 'The assistant is not configured.'
  if (err instanceof Anthropic.APIError) return `The assistant is unavailable (error ${err.status}).`
  return 'The assistant is unavailable.'
}

app.post('/api/ask', async c => {
  const body = await c.req.json<{ question?: string; context?: string }>().catch(() => null)
  const question = body?.question?.trim()
  if (!question) return c.json({ error: 'question is required' }, 400)
  if (question.length > 600) return c.json({ error: 'Keep the question under 600 characters.' }, 400)
  try {
    return c.json({ answer: await ask(c.env, question, await snapshotText(c.env), body?.context?.slice(0, 2000)) })
  } catch (err) {
    console.error('ask failed', err)
    return c.json({ error: aiError(err) }, 502)
  }
})

const LABEL_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
app.post('/api/label', async c => {
  const body = await c.req.json<{ data?: string; mediaType?: string; url?: string }>().catch(() => null)
  // A label can also be fetched straight from EPA's published label PDFs, and from nowhere else.
  if (body?.url) {
    const url = new URL(body.url, 'https://invalid.example')
    if (url.protocol !== 'https:' || url.hostname !== 'www3.epa.gov' || !url.pathname.startsWith('/pesticides/chem_search/ppls/') || !url.pathname.endsWith('.pdf')) {
      return c.json({ error: 'Only label PDFs published by EPA can be fetched by address.' }, 400)
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null)
    if (!res?.ok) return c.json({ error: 'The label could not be downloaded from EPA. Upload the PDF instead.' }, 502)
    const bytes = new Uint8Array(await res.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    body.data = btoa(binary)
    body.mediaType = 'application/pdf'
  }
  if (!body?.data || !body.mediaType || !LABEL_TYPES.includes(body.mediaType)) return c.json({ error: 'Send a photo (JPEG, PNG or WebP) or a PDF of the label.' }, 400)
  if (body.data.length > 12_000_000) return c.json({ error: 'That file is too large. Use a smaller photo or a PDF under 8 MB.' }, 400)
  try {
    return c.json(await readLabel(c.env, { data: body.data, mediaType: body.mediaType }))
  } catch (err) {
    console.error('label failed', err)
    return c.json({ error: aiError(err) }, 502)
  }
})

// Replies to alert texts arrive here from Linq and are answered the same way as the in-app question box.
async function verifyLinq(secret: string, body: string, headers: Headers): Promise<boolean> {
  const id = headers.get('webhook-id'), ts = headers.get('webhook-timestamp'), sig = headers.get('webhook-signature')
  if (!id || !ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const raw = Uint8Array.from(atob(secret.startsWith('whsec_') ? secret.slice(6) : secret), ch => ch.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const data = new TextEncoder().encode(`${id}.${ts}.${body}`)
  for (const part of sig.split(' ')) {
    if (!part.startsWith('v1,')) continue
    try {
      const given = Uint8Array.from(atob(part.slice(3)), ch => ch.charCodeAt(0))
      if (await crypto.subtle.verify('HMAC', key, given, data)) return true
    } catch { /* malformed signature */ }
  }
  return false
}

app.post('/api/linq/webhook', async c => {
  const secret = c.env.LINQ_WEBHOOK_SECRET
  if (!secret) return c.json({ error: 'webhook not configured' }, 503)
  const raw = await c.req.text()
  if (!(await verifyLinq(secret, raw, c.req.raw.headers))) return c.json({ error: 'bad signature' }, 401)
  const event = JSON.parse(raw) as { event_type?: string; data?: { direction?: string; sender_handle?: { handle?: string; is_me?: boolean }; parts?: { type: string; value?: string }[] } }
  const phone = event.data?.sender_handle?.handle
  const text = (event.data?.parts ?? []).filter(p => p.type === 'text').map(p => p.value ?? '').join(' ').trim()
  // Only people on the alert list get answers; anyone else texting the line is ignored.
  if (event.event_type !== 'message.received' || event.data?.direction !== 'inbound' || event.data.sender_handle?.is_me || !phone || !text || !alertPhones(c.env).includes(phone)) {
    return c.json({ ok: true, ignored: true })
  }
  c.executionCtx.waitUntil((async () => {
    let answer: string
    try { answer = await ask(c.env, text.slice(0, 600), await snapshotText(c.env)) } catch (err) { console.error('reply failed', err); answer = aiError(err) }
    await sendLinq(c.env, phone, answer)
  })())
  return c.json({ ok: true })
})

app.post('/api/demo', async c => c.json(await ranch(c.env).setDemo(await c.req.json())))

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // The WebSocket upgrade bypasses Hono so no middleware touches the 101 response.
    if (new URL(request.url).pathname === '/api/live') return ranch(env).fetch(request)
    return app.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
