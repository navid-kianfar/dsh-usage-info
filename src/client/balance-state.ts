/**
 * What the readout's balance half shows and what its poll does next, as pure decisions.
 *
 * Kept out of the component so the two questions that used to be tangled with rendering — "is there
 * anything to say?" and "is it worth asking again?" — can be answered, and tested, on their own. They
 * have different answers on purpose: a failure a person must fix is always worth SHOWING, while only
 * some are worth re-asking about on a timer.
 * @module @achasoft/dsh-usage-info/client/balance-state
 */

import type { UsageBalanceFailureCode, UsageBalanceResult, UsageInfoView } from '../host/types.ts'

/** What one tick of the balance cadence does. */
export type BalanceTick = 'none' | 'describe' | 'read'

/**
 * The failure the balance section reports, if any.
 *
 * Every failure is reported, including the three that used to hide the section: with the section
 * gone, a readout whose key was missing looked identical to one whose deployment had switched the
 * balance off, and nothing on screen said what to fix.
 * @param view - the Host's usage view, null before it has answered.
 * @param balance - the latest balance answer, null before one has landed.
 * @returns the failure to show, or undefined when there is none or the section is not shown at all.
 */
export function balanceFailure(
  view: UsageInfoView | null,
  balance: UsageBalanceResult | null,
): UsageBalanceFailureCode | undefined {
  if (view === null || !view.showBalance) return undefined
  if (!view.balanceAvailable) return 'no-provider'
  if (balance === null || balance.ok) return undefined
  return balance.code
}

/**
 * Decide what the next tick of the existing balance cadence does. No other timer exists for this: a
 * readout that is waiting for a provider or a key re-asks at the same interval a working one polls at.
 *
 * - No provider mounted: re-describe, because mounting one changes the view and not a balance answer.
 * - `not-configured`: keep reading. The Host answers a missing key without asking the provider, so
 *   the retry is free, and it is how a key stored after the page opened is picked up.
 * - `unsupported`: stop. The answer comes from the provider's endpoint, so polling it would spend a
 *   provider request per tab per interval to be told the same thing; a settings change re-asks.
 * @param view - the Host's usage view, null before it has answered.
 * @param balance - the latest balance answer, null before one has landed.
 * @returns the tick's action.
 */
export function balanceTick(view: UsageInfoView | null, balance: UsageBalanceResult | null): BalanceTick {
  if (view === null || !view.showBalance) return 'none'
  if (!view.balanceAvailable) return 'describe'
  if (balance !== null && !balance.ok && balance.code === 'unsupported') return 'none'
  return 'read'
}

/**
 * Operator-facing copy for one balance failure, saying what to do where there is something to do.
 * Error surfaces stay English by repository policy, so these are literals rather than dictionary keys.
 * @param code - the classified failure.
 * @returns a short operator-facing line.
 */
export function describeFailure(code: UsageBalanceFailureCode): string {
  switch (code) {
    case 'no-provider': return 'no balance provider is mounted; enable one, or hide the balance in settings'
    case 'not-configured': return 'no API key for the balance provider; this retries once one is stored'
    case 'unauthorized': return 'the balance endpoint rejected the API key'
    case 'unsupported': return 'this endpoint publishes no balance; hide the balance in settings'
    case 'provider-timeout': return 'the balance endpoint timed out'
    case 'provider-unavailable': return 'the balance endpoint is unreachable'
    case 'provider-rejected': return 'could not read the balance'
    default: {
      const unexpected: never = code
      throw new Error(`usage-info: unhandled balance failure code "${String(unexpected)}"`)
    }
  }
}
