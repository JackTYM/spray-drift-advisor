import { outlineCentre } from './field'
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

// Each block is a real pecan field. Its boundary was traced by hand from the USGS imagery,
// along the tracks and roads that edge it, and the centre is the average of its corners.
// The land falls about 26 ft from Block 1 to Block 3 (USGS elevation), so cold air drains toward Block 3.
const field = (id: string, name: string, note: string, outline: [number, number][], model: Pick<BlockModel, 'offsetF' | 'factor' | 'turnDeg' | 'sites'>): BlockModel =>
  ({ id, name, crop: 'Pecans', note, ...outlineCentre(outline), outline, ...model })

export const BLOCKS: BlockModel[] = [
  field('block-1', 'Block 1', 'Upslope, 2,734 ft',
    [[-110.962, 31.9379], [-110.9582, 31.9378], [-110.9585, 31.9328], [-110.9626, 31.9328]],
    { offsetF: 9, factor: 0.5, turnDeg: 10, sites: [] }),
  field('block-2', 'Block 2', 'Mid-slope, 2,720 ft',
    [[-110.9562, 31.9469], [-110.9531, 31.9469], [-110.9531, 31.9432], [-110.9564, 31.9432]],
    { offsetF: 7.5, factor: 0.7, turnDeg: 15, sites: [] }),
  field('block-3', 'Block 3', 'Low ground, 2,708 ft',
    [[-110.9552, 31.9555], [-110.9537, 31.9555], [-110.9537, 31.9551], [-110.9533, 31.9551], [-110.9533, 31.952], [-110.9555, 31.952]],
    { offsetF: 0, factor: 1, turnDeg: 20, // Real: twelve county address points on Sahuarita Road, the nearest 156 m north of the block centre.
    sites: [{ name: 'the homes on Sahuarita Road', type: 'homes', bearingDeg: 5, distanceM: 156 }] }),
]

/**
 * Real products with their EPA registration numbers and the label PDFs EPA publishes.
 * Names and numbers were checked against those labels on 2026-11-15. Volatility is "low" where the
 * label carries no vapor-drift warning. Limits are not stored here: they come from reading the label.
 */
export interface Product { name: string; volatility: 'low' | 'high'; epaRegNo: string; activeIngredient: string; labelUrl: string }
const EPA_LABELS = 'https://www3.epa.gov/pesticides/chem_search/ppls/'
export const PRODUCTS: Product[] = [
  { name: 'Closer SC', volatility: 'low', epaRegNo: '62719-623', activeIngredient: 'Sulfoxaflor 21.8%', labelUrl: `${EPA_LABELS}062719-00623-20210108.pdf` },
  { name: 'Intrepid 2F', volatility: 'low', epaRegNo: '62719-442', activeIngredient: 'Methoxyfenozide 22.6%', labelUrl: `${EPA_LABELS}062719-00442-20221012.pdf` },
  { name: 'Warrior II with Zeon Technology', volatility: 'low', epaRegNo: '100-1295', activeIngredient: 'Lambda-cyhalothrin 22.8%', labelUrl: `${EPA_LABELS}000100-01295-20250703.pdf` },
]
