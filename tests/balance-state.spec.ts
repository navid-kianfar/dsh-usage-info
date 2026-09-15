import { describe, expect, it } from 'vitest'
import { balanceFailure, balanceTick, describeFailure } from '../src/client/balance-state.ts'
import type { UsageBalanceResult, UsageInfoView } from '../src/host/types.ts'

/** A view with a mounted, ready provider and the balance switched on. */
const VIEW: UsageInfoView = {
  balanceAvailable: true,
  provider: 'account-balance-deepseek',
  ready: true,
  showContext: true,
  showCost: false,
  showBalance: true,
  costCurrency: 'USD',
  refreshIntervalMs: 300_000,
}

const failure = (code: Extract<UsageBalanceResult, { ok: false }>['code']): UsageBalanceResult =>
  ({ ok: false, code, message: code })

describe('balanceFailure', () => {
  it('shows nothing while the balance is off or the Host has not answered', () => {
    expect(balanceFailure(null, null)).toBeUndefined()
    expect(balanceFailure({ ...VIEW, showBalance: false }, failure('not-configured'))).toBeUndefined()
  })

  it('reports a deployment with no provider, which previously hid the section entirely', () => {
    expect(balanceFailure({ ...VIEW, balanceAvailable: false, ready: false }, null)).toBe('no-provider')
  })

  it.each(['not-configured', 'unsupported', 'unauthorized', 'provider-timeout'] as const)(
    'reports %s as the section state instead of hiding the section',
    (code) => {
      expect(balanceFailure(VIEW, failure(code))).toBe(code)
    },
  )

  it('has no failure to report while a reading stands or none has landed yet', () => {
    expect(balanceFailure(VIEW, null)).toBeUndefined()
    expect(balanceFailure(VIEW, { ok: true, available: true, amounts: [], fetchedAt: 0 })).toBeUndefined()
  })
})

describe('balanceTick', () => {
  it('does nothing while the balance is off or the Host has not answered', () => {
    expect(balanceTick(null, null)).toBe('none')
    expect(balanceTick({ ...VIEW, showBalance: false }, null)).toBe('none')
  })

  it('re-describes on the cadence while no provider is mounted, so mounting one is noticed', () => {
    expect(balanceTick({ ...VIEW, balanceAvailable: false, ready: false }, null)).toBe('describe')
  })

  it('keeps reading after not-configured, so a key stored later is picked up without a reload', () => {
    // A missing key is answered on the Host without asking the provider, so this costs no request.
    expect(balanceTick(VIEW, failure('not-configured'))).toBe('read')
  })

  it('reads again once a provider is mounted, even over a stale no-provider answer', () => {
    expect(balanceTick(VIEW, failure('no-provider'))).toBe('read')
  })

  it('stops polling an endpoint that publishes no balance; a settings change re-asks instead', () => {
    expect(balanceTick(VIEW, failure('unsupported'))).toBe('none')
  })

  it('keeps reading through a transient failure', () => {
    expect(balanceTick(VIEW, failure('provider-unavailable'))).toBe('read')
  })
})

describe('describeFailure', () => {
  it('says what to do for the failures a person has to fix', () => {
    expect(describeFailure('no-provider')).toMatch(/settings/u)
    expect(describeFailure('not-configured')).toMatch(/API key/u)
    expect(describeFailure('unsupported')).toMatch(/settings/u)
  })
})
