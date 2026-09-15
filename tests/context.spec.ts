import { describe, expect, it } from 'vitest'
import { contextOccupancy, contextParts, formatTokens } from '../src/client/context.ts'

describe('contextOccupancy', () => {
  it('prefers the projection that answers for the next request', () => {
    // projectedTokens is pressureTokens plus the surface's movement since that sample, so it is the
    // one that reacts to a compaction the provider never reported usage for.
    const occupancy = contextOccupancy({ pressureTokens: 90_000, projectedTokens: 40_000, contextWindow: 100_000 })
    expect(occupancy).toEqual({ percent: 40, usedTokens: 40_000, contextWindow: 100_000 })
  })

  it('falls back to the raw pressure sample before any surface movement is known', () => {
    expect(contextOccupancy({ pressureTokens: 25_000, contextWindow: 100_000 })?.percent).toBe(25)
  })

  it('reads as unknown while either half of the fraction is missing', () => {
    expect(contextOccupancy(undefined)).toBeNull()
    expect(contextOccupancy({ contextWindow: 100_000 })).toBeNull()
    expect(contextOccupancy({ pressureTokens: 10 })).toBeNull()
  })

  it('reads a zero or unusable capacity as unknown rather than dividing by it', () => {
    // 0 / 0 is NaN and n / 0 is Infinity; either would reach the header as "NaN%" or a full ring.
    expect(contextOccupancy({ pressureTokens: 0, contextWindow: 0 })).toBeNull()
    expect(contextOccupancy({ pressureTokens: 1_000, contextWindow: 0 })).toBeNull()
    expect(contextOccupancy({ pressureTokens: 1_000, contextWindow: -1 })).toBeNull()
    expect(contextOccupancy({ pressureTokens: 1_000, contextWindow: Number.NaN })).toBeNull()
  })

  it('clamps a prompt priced above the advertised capacity', () => {
    expect(contextOccupancy({ pressureTokens: 150_000, contextWindow: 100_000 })?.percent).toBe(100)
  })
})

describe('contextParts', () => {
  it('reports each part as a share of the composition', () => {
    expect(contextParts({ systemTokens: 250, toolsTokens: 250, messageTokens: 500 })).toEqual([
      { key: 'systemTokens', tokens: 250, percent: 25 },
      { key: 'toolsTokens', tokens: 250, percent: 25 },
      { key: 'messageTokens', tokens: 500, percent: 50 },
    ])
  })

  it('has nothing to split before anything has been priced', () => {
    expect(contextParts(undefined)).toEqual([])
    expect(contextParts({ systemTokens: 0, toolsTokens: 0, messageTokens: 0 })).toEqual([])
  })
})

describe('formatTokens', () => {
  it('keeps every reading to four characters or fewer', () => {
    expect(formatTokens(840)).toBe('840')
    expect(formatTokens(1_240)).toBe('1.2K')
    expect(formatTokens(124_000)).toBe('124K')
    expect(formatTokens(1_240_000)).toBe('1.2M')
  })
})
