import type { RanchDO } from './ranch-do'

export interface Env {
  RANCH: DurableObjectNamespace<RanchDO>
  DATABASE_URL: string
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
  ANTHROPIC_API_KEY: string
  /** Signing secret of the Linq webhook subscription that delivers replies to alerts. */
  LINQ_WEBHOOK_SECRET?: string
  LINQ_API_KEY?: string
  /** Comma-separated E.164 numbers that receive iMessage alerts. */
  ALERT_PHONES?: string
}
