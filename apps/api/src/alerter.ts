import { buildPushPayload, type PushSubscription } from '@block65/webcrypto-web-push'
import { deleteSubscription, insertAlert, subscriptions, type Sql } from './db'
import type { Env } from './env'

export interface AlertMessage { kind: string; blockId: string; sessionId: string | null; title: string; body: string }

async function push(env: Env, sql: Sql, a: AlertMessage) {
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
  for (const row of await subscriptions(sql)) {
    const sub = row.subscription as PushSubscription
    let ok = false
    let detail = ''
    try {
      const init = await buildPushPayload({ data: JSON.stringify({ title: a.title, body: a.body, tag: a.blockId }), options: { ttl: 300, urgency: 'high' } }, sub, vapid)
      const res = await fetch(sub.endpoint, init)
      ok = res.ok
      detail = `HTTP ${res.status}`
      if (res.status === 404 || res.status === 410) await deleteSubscription(sql, sub.endpoint)
    } catch (err) {
      detail = String(err)
    }
    await insertAlert(sql, { ...a, channel: 'push', recipient: new URL(sub.endpoint).host, ok, detail })
  }
}

/** Sends one text through Linq, which delivers it as iMessage, RCS or SMS depending on the recipient. */
export async function sendLinq(env: Env, phone: string, text: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch('https://api.linqapp.com/api/partner/v3/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINQ_API_KEY}` },
      body: JSON.stringify({ message: { parts: [{ type: 'text', value: text }] }, to: [phone] }),
    })
    return { ok: res.ok, detail: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, detail: String(err) }
  }
}

export const alertPhones = (env: Env): string[] => (env.ALERT_PHONES ?? '').split(',').map(p => p.trim()).filter(Boolean)

async function imessage(env: Env, sql: Sql, a: AlertMessage) {
  if (!env.LINQ_API_KEY) return
  for (const phone of alertPhones(env)) {
    const r = await sendLinq(env, phone, `${a.title}\n${a.body}`)
    await insertAlert(sql, { ...a, channel: 'imessage', recipient: phone, ...r })
  }
}

export async function sendAlert(env: Env, sql: Sql, a: AlertMessage): Promise<void> {
  await Promise.allSettled([push(env, sql, a), imessage(env, sql, a)])
}
