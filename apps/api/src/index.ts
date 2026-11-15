import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { parseReading, readingsFromCsv, summarize, type CsvMapping } from '@drift/engine'
import { alertRows, db, insertRecorded, latestBacktest, logRows, saveSubscription, sessionById, sessionRows } from './db'
import type { Env } from './env'

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

app.get('/api/alerts', async c => c.json(await alertRows(db(c.env), null, 30)))
app.get('/api/backtest', async c => c.json(await latestBacktest(db(c.env))))

app.post('/api/push/subscribe', async c => {
  const body = await c.req.json<{ role: string; subscription: { endpoint: string } }>().catch(() => null)
  if (!body?.subscription?.endpoint) return c.json({ error: 'subscription is required' }, 400)
  await saveSubscription(db(c.env), body.role ?? 'applicator', body.subscription)
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
