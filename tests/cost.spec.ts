import { describe, expect, it } from 'vitest'
import { sessionCost, type UsageTokens } from '../src/client/cost.ts'

/** Rates used across these cases: a cache miss, a cache hit, and output. */
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

describe('sessionCost', () => {
  it('prices each bucket at its own rate', () => {
    // 1M of each bucket: 0.28 + 0.028 + 0.42, with output billed at its own rate.
    expect(sessionCost(usage({
      uncachedInputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      outputTokens: 1_000_000,
    }), RATES)).toBe('0.728')
  })

  it('bills cache writes at the input rate', () => {
    expect(sessionCost(usage({ cacheWriteTokens: 1_000_000 }), RATES)).toBe('0.28')
    expect(sessionCost(usage({ cacheWriteTokens: 500_000, uncachedInputTokens: 500_000 }), RATES))
      .toBe('0.28')
  })

  it('reports null before anything has been billed, not zero', () => {
    expect(sessionCost(usage({}), RATES)).toBeNull()
    // Tokens billed at a zero rate are the other case: the session HAS been billed, at nothing.
    expect(sessionCost(usage({ outputTokens: 1_000 }), { ...RATES, output: '0' })).toBe('0')
  })

  it('stays exact where floating point drifts', () => {
    // 64,700 cache-hit tokens at 0.028/M is 0.0018116 — the classic 0.1 + 0.2 shape, where a Number
    // computation would land a few ulps away from the digits a person is reading.
    expect(sessionCost(usage({ cacheReadTokens: 64_700 }), RATES)).toBe('0.001812')
  })

  it('rounds half-up at the sixth decimal, and trims trailing zeros', () => {
    // 0.5 micro-units rounds up; the trailing zeros of an exact figure are dropped.
    expect(sessionCost(usage({ uncachedInputTokens: 5 }), { input: '0.1', cacheRead: '0', output: '0' }))
      .toBe('0.000001')
    expect(sessionCost(usage({ outputTokens: 1_000_000 }), RATES)).toBe('0.42')
  })

  it('reads rates quoted past the precision money resolves', () => {
    // 1M tokens at 0.0000005/M is half a micro-unit: it rounds up to the nearest representable figure
    // rather than being truncated to nothing.
    expect(sessionCost(usage({ outputTokens: 1_000_000 }), { ...RATES, output: '0.0000005' }))
      .toBe('0.000001')
  })

  it('handles a session measured in billions of tokens', () => {
    expect(sessionCost(usage({ outputTokens: 2_500_000_000 }), RATES)).toBe('1050')
  })
})
