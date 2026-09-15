import { describe, expect, it } from 'vitest'
import type { UsageTokens } from '../src/client/cost.ts'
import type { ContextOccupancy } from '../src/client/context.ts'
import { costSummary, triggerFace } from '../src/client/readout-state.ts'
import type { UsageBalanceAmount } from '../src/host/types.ts'

/** A context reading a session has after its first request. */
const OCCUPANCY: ContextOccupancy = { percent: 12, usedTokens: 12_000, contextWindow: 100_000 }

/** A balance amount as a successful reading carries it. */
const AMOUNT: UsageBalanceAmount = { currency: 'CNY', total: '42.50' }

/** Rates used across the cost cases. */
const RATES = { input: '0.28', cacheRead: '0.028', output: '0.42' }

/** One usage reading with only the buckets a case names set. */
function usage(tokens: Partial<UsageTokens>): UsageTokens {
  return {
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    ...tokens,
  }
}

describe('triggerFace', () => {
  it('draws the glyph, not an empty button, before any reading or failure exists', () => {
    expect(triggerFace(null, undefined, undefined)).toBe('glyph')
  })

  it('adds the warning dot when a balance failure is the only thing known', () => {
    expect(triggerFace(null, undefined, 'no-provider')).toBe('attention')
    expect(triggerFace(null, undefined, 'unauthorized')).toBe('attention')
  })

  it('keeps the readings as soon as either one exists, failure or not', () => {
    expect(triggerFace(OCCUPANCY, undefined, undefined)).toBe('readings')
    expect(triggerFace(null, AMOUNT, undefined)).toBe('readings')
    expect(triggerFace(OCCUPANCY, AMOUNT, undefined)).toBe('readings')
    // The ring is still true beside a balance failure; the panel spells the failure out.
    expect(triggerFace(OCCUPANCY, undefined, 'provider-timeout')).toBe('readings')
  })
})

describe('costSummary', () => {
  it('is pending before the usage projection exists', () => {
    expect(costSummary(null, RATES)).toEqual({ state: 'pending' })
  })

  it('is pending while the view carries no rates', () => {
    expect(costSummary(usage({ outputTokens: 1_000 }), undefined)).toEqual({ state: 'pending' })
  })

  it('is pending, not a total of 0, when every bucket is zero', () => {
    expect(costSummary(usage({}), RATES)).toEqual({ state: 'pending' })
  })

  it('carries the priced amount, the token total and the buckets once something is billed', () => {
    const tokens = usage({ uncachedInputTokens: 1_000_000, cacheWriteTokens: 500, cacheReadTokens: 250, outputTokens: 1_000_000 })
    // Worked by hand: (1,000,000 + 500) x 0.28 + 250 x 0.028 + 1,000,000 x 0.42, per million.
    expect(costSummary(tokens, RATES)).toEqual({
      state: 'priced',
      amount: '0.700147',
      totalTokens: 2_000_750,
      tokens,
    })
  })

  it('prices tokens billed at a zero rate as a figure of zero, which is a claim and not a placeholder', () => {
    const free = { input: '0', cacheRead: '0', output: '0' }
    expect(costSummary(usage({ outputTokens: 10 }), free)).toMatchObject({ state: 'priced', amount: '0', totalTokens: 10 })
  })
})

