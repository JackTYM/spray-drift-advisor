const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', hour: 'numeric', minute: '2-digit' })
const stamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })

export const fmtTime = (ms: number | string) => time.format(new Date(ms))
export const fmtStamp = (ms: number | string) => stamp.format(new Date(ms))
export const compass = (deg: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]
