import { describe, expect, it } from 'vitest'
import {
  compareDecimal,
  formatAmount,
  formatDecimal,
  isLowBalance,
  readingAge,
} from '../src/client/money.ts'

describe('compareDecimal', () => {
  it('orders by value, not by string length', () => {
    expect(compareDecimal('9', '10')).toBeLessThan(0)
    expect(compareDecimal('10', '9')).toBeGreaterThan(0)
  })

  it('treats trailing and leading zeros as no value', () => {
    expect(compareDecimal('1.50', '1.5')).toBe(0)
    expect(compareDecimal('01.5', '1.5')).toBe(0)
    expect(compareDecimal('1', '1.000')).toBe(0)
  })

  it('compares fractions digit-wise past float precision', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; these two differ only past the 17th digit, where a
    // Number-based comparison would report them equal.
    expect(compareDecimal('0.30000000000000001', '0.30000000000000002')).toBeLessThan(0)
    expect(compareDecimal('1000000000000000000000.01', '1000000000000000000000.02')).toBeLessThan(0)
  })

  it('orders negatives below positives and among themselves', () => {
    expect(compareDecimal('-1', '1')).toBeLessThan(0)
    expect(compareDecimal('-10', '-9')).toBeLessThan(0)
    expect(compareDecimal('-0.5', '-0.25')).toBeLessThan(0)
  })

  it('reads every spelling of zero as one value', () => {
    expect(compareDecimal('-0.00', '0')).toBe(0)
    expect(compareDecimal('0', '+0.0')).toBe(0)
  })
})

describe('isLowBalance', () => {
  it('warns at and below the threshold', () => {
    expect(isLowBalance('9.99', '10.00')).toBe(true)
    expect(isLowBalance('10.00', '10.00')).toBe(true)
    expect(isLowBalance('10.01', '10.00')).toBe(false)
  })

  it('never warns without a configured threshold', () => {
    expect(isLowBalance('0.00', undefined)).toBe(false)
  })
})

describe('formatDecimal', () => {
  it('groups the integer part and leaves every digit as received', () => {
    expect(formatDecimal('1234567.89')).toBe('1,234,567.89')
    expect(formatDecimal('999')).toBe('999')
    expect(formatDecimal('1000')).toBe('1,000')
  })

  it('preserves trailing zeros the provider chose to send', () => {
    expect(formatDecimal('110.00')).toBe('110.00')
    expect(formatDecimal('0.10')).toBe('0.10')
  })

  it('keeps a negative sign outside the grouping', () => {
    expect(formatDecimal('-12345.6')).toBe('-12,345.6')
  })
})

describe('formatAmount', () => {
  it('labels the figure with the ISO code rather than a symbol', () => {
    expect(formatAmount('CNY', '110.00')).toBe('CNY 110.00')
    expect(formatAmount('USD', '1234.5')).toBe('USD 1,234.5')
  })
})

describe('readingAge', () => {
  const base = 1_700_000_000_000

  it('reports the largest unit that yields a whole number', () => {
    expect(readingAge(base, base + 30_000)).toEqual({ unit: 'now', value: 0 })
    expect(readingAge(base, base + 90_000)).toEqual({ unit: 'minutes', value: 1 })
    expect(readingAge(base, base + 3_600_000)).toEqual({ unit: 'hours', value: 1 })
    expect(readingAge(base, base + 86_400_000 * 3)).toEqual({ unit: 'days', value: 3 })
  })

  it('reads clock skew as "now" rather than as a negative age', () => {
    expect(readingAge(base + 5_000, base)).toEqual({ unit: 'now', value: 0 })
  })
})
