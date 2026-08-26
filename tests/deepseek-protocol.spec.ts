import { describe, expect, it } from 'vitest'
import { isBalanceError } from '../src/balance/index.ts'
import { classifyHttpFailure, parseBalanceBody } from '../src/providers/deepseek-protocol.ts'

/** One well-formed body, as the API documents it. */
const BODY = {
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
  ],
}

describe('parseBalanceBody', () => {
  it('carries every figure across as the decimal string it arrived as', () => {
    expect(parseBalanceBody(BODY, 42)).toEqual({
      available: true,
      fetchedAt: 42,
      amounts: [{ currency: 'CNY', total: '110.00', granted: '10.00', toppedUp: '100.00' }],
    })
  })

  it('uppercases the currency so a display can key on it', () => {
    const reading = parseBalanceBody({ ...BODY, balance_infos: [{ currency: 'usd', total_balance: '5' }] }, 0)
    expect(reading.amounts[0]?.currency).toBe('USD')
  })

  it('omits the split fields the provider did not send', () => {
    const reading = parseBalanceBody({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '5' }] }, 0)
    expect(reading.amounts[0]).toEqual({ currency: 'USD', total: '5' })
  })

  it('reads an empty account as a reading, not a failure', () => {
    expect(parseBalanceBody({ is_available: false, balance_infos: [] }, 7))
      .toEqual({ available: false, amounts: [], fetchedAt: 7 })
  })

  it('rejects a figure sent as a JSON number', () => {
    const body = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: 110 }] }
    expect(() => parseBalanceBody(body, 0)).toThrowError(/not a decimal string/u)
  })

  it('rejects exponent notation, which no display could round-trip exactly', () => {
    const body = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '1.1e2' }] }
    expect(() => parseBalanceBody(body, 0)).toThrowError(/not a decimal string/u)
  })

  it.each([
    ['a non-object body', 'nope'],
    ['a missing availability flag', { balance_infos: [] }],
    ['a missing entry array', { is_available: true }],
    ['an entry without a currency', { is_available: true, balance_infos: [{ total_balance: '1' }] }],
  ])('classifies %s as provider-rejected', (_label, body) => {
    try {
      parseBalanceBody(body, 0)
      expect.unreachable('expected a classified failure')
    } catch (error) {
      expect(isBalanceError(error)).toBe(true)
      expect((error as { code: string }).code).toBe('provider-rejected')
    }
  })
})

describe('classifyHttpFailure', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'unsupported'],
    [408, 'provider-timeout'],
    [504, 'provider-timeout'],
    [429, 'provider-unavailable'],
    [500, 'provider-unavailable'],
    [503, 'provider-unavailable'],
    [400, 'provider-rejected'],
    [418, 'provider-rejected'],
  ])('maps %i to %s', (status, code) => {
    expect(classifyHttpFailure(status, '').code).toBe(code)
  })

  it('keeps the endpoint diagnostic in the message when there is one', () => {
    expect(classifyHttpFailure(401, 'bad key').message).toContain('bad key')
  })
})
