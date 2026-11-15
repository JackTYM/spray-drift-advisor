import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import type { Evaluation, Reading, SessionState } from '@drift/engine'
import type { Env } from './env'

export type Sql = NeonQueryFunction<false, false>
export const db = (env: Env): Sql => neon(env.DATABASE_URL)
const iso = (ms: number) => new Date(ms).toISOString()

export async function insertEvaluation(sql: Sql, blockId: string, timeMs: number, reading: Reading | undefined, ev: Evaluation, sessionId: string | null) {
  const t = iso(timeMs)
  const triggers = JSON.stringify(ev.triggers)
  if (reading) {
    await sql`
      with r as (
        insert into readings (source, kind, block_id, time, levels)
        values (${reading.source}, ${reading.kind}, ${blockId}, ${t}, ${JSON.stringify(reading.levels)}::jsonb)
        returning id
      )
      insert into evaluations (reading_id, block_id, time, status, ground_status, delta_f, ri, triggers, session_id)
      select id, ${blockId}, ${t}, ${ev.status}, ${ev.groundOnly.status}, ${ev.deltaF}, ${ev.ri}, ${triggers}::jsonb, ${sessionId} from r`
  } else {
    await sql`
      insert into evaluations (reading_id, block_id, time, status, ground_status, delta_f, ri, triggers, session_id)
      values (null, ${blockId}, ${t}, ${ev.status}, ${ev.groundOnly.status}, ${ev.deltaF}, ${ev.ri}, ${triggers}::jsonb, ${sessionId})`
  }
}

export const logRows = (sql: Sql, blockId: string | null, sessionId: string | null, limit: number) => sql`
  select e.id, e.time, e.block_id, e.status, e.ground_status, e.delta_f, e.ri, e.triggers, e.session_id, r.levels, r.source, r.kind
  from evaluations e left join readings r on r.id = e.reading_id
  where (${blockId}::text is null or e.block_id = ${blockId})
    and (${sessionId}::text is null or e.session_id = ${sessionId})
  order by e.id desc limit ${limit}`

export const upsertSession = (sql: Sql, s: SessionState) => sql`
  insert into sessions (id, block_id, phase, started_at, finished_at, override_reason, state)
  values (${s.id}, ${s.blockId}, ${s.phase}, ${iso(s.startedMs)}, ${s.finishedMs ? iso(s.finishedMs) : null}, ${s.overrideReason ?? null}, ${JSON.stringify(s)}::jsonb)
  on conflict (id) do update set phase = excluded.phase, finished_at = excluded.finished_at, override_reason = excluded.override_reason, state = excluded.state`

/** Per job: the worst status seen while it ran, how many evaluations were logged, and how many alerts went out. */
export const sessionStats = (sql: Sql) => sql`
  select e.session_id,
         max(case e.status when 'STOP' then 2 when 'CAUTION' then 1 else 0 end) as worst,
         count(*)::int as evaluations,
         (select count(*)::int from alerts a where a.session_id = e.session_id) as alerts
  from evaluations e where e.session_id is not null group by e.session_id`

/** The logged evaluation closest to a moment, if the tower was reporting within ten minutes of it. */
export const evaluationNear = async (sql: Sql, blockId: string, timeIso: string) => (await sql`
  select e.time, e.status, e.ground_status, e.delta_f, e.ri, e.triggers, r.levels
  from evaluations e join readings r on r.id = e.reading_id
  where e.block_id = ${blockId} and e.time between ${timeIso}::timestamptz - interval '10 minutes' and ${timeIso}::timestamptz + interval '10 minutes'
  order by abs(extract(epoch from (e.time - ${timeIso}::timestamptz))) limit 1`)[0]

export const sessionRows = (sql: Sql, limit: number) => sql`select state from sessions order by started_at desc limit ${limit}`
export const sessionById = async (sql: Sql, id: string) => (await sql`select state from sessions where id = ${id}`)[0]?.state as SessionState | undefined

export const insertAlert = (sql: Sql, a: { sessionId: string | null; blockId: string; kind: string; channel: string; recipient: string; ok: boolean; detail: string; title: string; body: string }) => sql`
  insert into alerts (session_id, block_id, kind, channel, recipient, ok, detail, title, body)
  values (${a.sessionId}, ${a.blockId}, ${a.kind}, ${a.channel}, ${a.recipient}, ${a.ok}, ${a.detail}, ${a.title}, ${a.body})`
export const alertRows = (sql: Sql, sessionId: string | null, limit: number) => sql`
  select * from alerts where (${sessionId}::text is null or session_id = ${sessionId}) order by id desc limit ${limit}`

export const saveSubscription = (sql: Sql, role: string, sub: { endpoint: string }) => sql`
  insert into push_subscriptions (endpoint, role, subscription) values (${sub.endpoint}, ${role}, ${JSON.stringify(sub)}::jsonb)
  on conflict (endpoint) do update set role = excluded.role, subscription = excluded.subscription`
export const subscriptions = (sql: Sql) => sql`select subscription from push_subscriptions`
export const deleteSubscription = (sql: Sql, endpoint: string) => sql`delete from push_subscriptions where endpoint = ${endpoint}`

export const cachePut = (sql: Sql, key: string, payload: unknown) => sql`
  insert into weather_cache (key, fetched_at, payload) values (${key}, now(), ${JSON.stringify(payload)}::jsonb)
  on conflict (key) do update set fetched_at = excluded.fetched_at, payload = excluded.payload`
export const cacheGet = async (sql: Sql, key: string) => (await sql`select payload from weather_cache where key = ${key}`)[0]?.payload

export const insertRecorded = (sql: Sql, source: string, blockId: string, readings: Reading[]) => sql`
  insert into recorded_tower (source, block_id, time, levels)
  select ${source}, ${blockId}, (x->>'time')::timestamptz, x->'levels'
  from jsonb_array_elements(${JSON.stringify(readings)}::jsonb) x`

export const latestBacktest = async (sql: Sql) => (await sql`select label, created_at, result from backtest_results order by id desc limit 1`)[0] ?? null

export const resetLog = (sql: Sql) => sql`truncate readings, evaluations, sessions, alerts restart identity cascade`
