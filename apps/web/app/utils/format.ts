const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', hour: 'numeric', minute: '2-digit' })
const stamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })

export const fmtTime = (ms: number | string) => time.format(new Date(ms))
export const fmtStamp = (ms: number | string) => stamp.format(new Date(ms))
export const compass = (deg: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]

const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', weekday: 'short' })
const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', hour: 'numeric' })
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix' })
export const fmtDay = (ms: number) => day.format(new Date(ms))
export const fmtHour = (ms: number) => hour.format(new Date(ms)).replace(' ', '').toLowerCase()
/** A time with its weekday unless it is today, such as "4:15 PM" or "Mon 5:00 PM". */
export const fmtWhen = (ms: number, nowMs = Date.now()) => (dayKey.format(new Date(ms)) === dayKey.format(new Date(nowMs)) ? fmtTime(ms) : `${fmtDay(ms)} ${fmtTime(ms)}`)
