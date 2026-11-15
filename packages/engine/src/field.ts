/** Field geometry in local metres: x is east, y is north, origin at the block centre. */

const M_PER_DEG = 111_320
export interface Pt { x: number; y: number }

export const toLocal = (lat0: number, lon0: number, lat: number, lon: number): Pt =>
  ({ x: (lon - lon0) * M_PER_DEG * Math.cos((lat0 * Math.PI) / 180), y: (lat - lat0) * M_PER_DEG })
export const toLngLat = (lat0: number, lon0: number, x: number, y: number): [number, number] =>
  [lon0 + x / (M_PER_DEG * Math.cos((lat0 * Math.PI) / 180)), lat0 + y / M_PER_DEG]

/** Centre of an outline given as [lon, lat] corners. */
export function outlineCentre(outline: [number, number][]): { lat: number; lon: number } {
  const r = (n: number) => Math.round(n * 1e5) / 1e5
  return { lat: r(outline.reduce((s, p) => s + p[1], 0) / outline.length), lon: r(outline.reduce((s, p) => s + p[0], 0) / outline.length) }
}
export const localOutline = (b: { lat: number; lon: number; outline: [number, number][] }): Pt[] =>
  b.outline.map(([lon, lat]) => toLocal(b.lat, b.lon, lat, lon))
export const squareOutline = (half: number): Pt[] => [{ x: -half, y: half }, { x: half, y: half }, { x: half, y: -half }, { x: -half, y: -half }]

export function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function bounds(poly: Pt[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

/** East-west tree rows clipped to the field: one or more spans per row. */
export function rowSpans(poly: Pt[], spacing: number, inset = 4): { y: number; x0: number; x1: number }[] {
  const b = bounds(poly)
  const out: { y: number; x0: number; x1: number }[] = []
  for (let y = b.minY + spacing / 2; y < b.maxY; y += spacing) {
    const xs: number[] = []
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const p = poly[i]!, q = poly[j]!
      if (p.y > y !== q.y > y) xs.push(((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x)
    }
    xs.sort((m, n) => m - n)
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1]! - xs[k]! > 2 * inset + 4) out.push({ y, x0: xs[k]! + inset, x1: xs[k + 1]! - inset })
  }
  return out
}

/** A random point inside the field. */
export function randomPointIn(poly: Pt[], rand: () => number): Pt {
  const b = bounds(poly)
  for (let i = 0; i < 200; i++) {
    const p = { x: b.minX + rand() * (b.maxX - b.minX), y: b.minY + rand() * (b.maxY - b.minY) }
    if (pointInPolygon(p.x, p.y, poly)) return p
  }
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
}
