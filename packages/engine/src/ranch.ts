import type { BlockModel } from './tower'

export const RANCH = {
  name: 'Sahuarita pecan ranch (demo)',
  lat: 31.95,
  lon: -110.96,
  utcOffset: '-07:00',
  timeZone: 'America/Phoenix',
  groundStation: 'az38',
  groundStationName: 'AZMet Sahuarita',
}

export const BLOCKS: BlockModel[] = [
  { id: 'block-1', name: 'Block 1', crop: 'Pecans', note: 'Upslope', lat: 31.956, lon: -110.958, offsetF: 9, factor: 0.5, turnDeg: 10, sites: [] },
  { id: 'block-2', name: 'Block 2', crop: 'Pecans', note: 'Mid-slope', lat: 31.95, lon: -110.96, offsetF: 7.5, factor: 0.7, turnDeg: 15, sites: [] },
  {
    id: 'block-3', name: 'Block 3', crop: 'Pecans', note: 'Low ground', lat: 31.944, lon: -110.962, offsetF: 0, factor: 1, turnDeg: 20,
    sites: [{ name: 'the neighboring school', type: 'school', bearingDeg: 95, distanceM: 600 }],
  },
]

export const PRODUCTS = [
  { name: 'Example product A (low volatility)', volatility: 'low' as const },
  { name: 'Example product B (high volatility)', volatility: 'high' as const },
]
