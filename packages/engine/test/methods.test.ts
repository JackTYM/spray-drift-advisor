import { describe, expect, it } from 'vitest'
import { APPLICATION_METHODS, jobMinutesFor } from '../src/methods'

describe('jobMinutesFor', () => {
  it('adds setup to acres over rate and rounds to 5 minutes', () => {
    expect(jobMinutesFor(100, 100, 10)).toBe(70)
    expect(jobMinutesFor(33, 60, 10)).toBe(45)
  })
  it('never goes below 15 minutes', () => {
    expect(jobMinutesFor(1, 150, 0)).toBe(15)
  })
  it('airblast default gives about 45 minutes for 20 acres', () => {
    const m = APPLICATION_METHODS.find(x => x.id === 'airblast')!
    expect(jobMinutesFor(20, m.acresPerHour, m.setupMinutes)).toBe(45)
  })
  it('airblast is slowest and airplane fastest', () => {
    const rates = APPLICATION_METHODS.map(m => m.acresPerHour)
    expect(APPLICATION_METHODS.find(m => m.acresPerHour === Math.max(...rates))!.id).toBe('airplane')
    expect(APPLICATION_METHODS.find(m => m.acresPerHour === Math.min(...rates))!.id).toBe('airblast')
  })
})
