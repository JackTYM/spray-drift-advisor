import type { BlockModel } from './tower'

export const RANCH = {
  name: 'Sahuarita pecan ranch (demo)',
  lat: 31.945,
  lon: -110.956,
  utcOffset: '-07:00',
  timeZone: 'America/Phoenix',
  groundStation: 'az38',
  groundStationName: 'AZMet Sahuarita',
}

// Block centres sit on ground the USDA Cropland Data Layer maps as pecans; elevations are from USGS.
// The land falls about 26 ft from Block 1 to Block 3, so cold air drains toward Block 3.
export const BLOCKS: BlockModel[] = [
  { id: 'block-1', name: 'Block 1', crop: 'Pecans', note: 'Upslope, 2,734 ft', lat: 31.934, lon: -110.96, offsetF: 9, factor: 0.5, turnDeg: 10, sites: [] },
  { id: 'block-2', name: 'Block 2', crop: 'Pecans', note: 'Mid-slope, 2,720 ft', lat: 31.946, lon: -110.956, offsetF: 7.5, factor: 0.7, turnDeg: 15, sites: [] },
  {
    id: 'block-3', name: 'Block 3', crop: 'Pecans', note: 'Low ground, 2,708 ft', lat: 31.954, lon: -110.952, offsetF: 0, factor: 1, turnDeg: 20,
    sites: [{ name: 'the neighboring school', type: 'school', bearingDeg: 95, distanceM: 600 }],
  },
]

export const PRODUCTS = [
  { name: 'Example product A (low volatility)', volatility: 'low' as const },
  { name: 'Example product B (high volatility)', volatility: 'high' as const },
]
