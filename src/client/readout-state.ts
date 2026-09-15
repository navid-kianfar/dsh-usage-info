/**
 * What the readout's header button and its cost section show, as pure decisions.
 *
 * Kept out of the component for the same reason as {@link ./balance-state.ts}: the empty states are
 * where this readout used to look broken — a button with nothing inside it, a figure of `0` beside a
 * line saying nothing had been billed — and a decision that can be tested on its own stays fixed.
 * @module @achasoft/dsh-usage-info/client/readout-state
 */

import type { UsageBalanceAmount, UsageBalanceFailureCode } from '../host/types.ts'
import type { ContextOccupancy } from './context.ts'
import { sessionCost, type CostRates, type UsageTokens } from './cost.ts'

/**
 * What the header button draws.
 *
 * - `readings`: the context ring and/or the balance figure, as soon as either exists.
 * - `glyph`: the usage glyph alone, so a button with no reading yet is still recognisable.
 * - `attention`: the glyph with a warning dot, when the only thing the readout knows is that the
 *   balance cannot be read.
 */
export type TriggerFace = 'readings' | 'glyph' | 'attention'

/**
 * Decide what the header button draws.
 *
 * A failure beside a reading does not change the face: the ring and the figure are still true, and the
 * failure is spelled out in the panel. It only earns the dot when there is nothing else to show, which
 * is exactly when a person would otherwise have no hint that the panel has something to tell them.
 * @param occupancy - the context reading, null before the first request or while context is hidden.
 * @param primary - the first balance amount, undefined before a reading has landed.
 * @param failure - the balance failure the panel reports, if any.
 * @returns the button's face.
 */
export function triggerFace(
  occupancy: ContextOccupancy | null,
  primary: UsageBalanceAmount | undefined,
  failure: UsageBalanceFailureCode | undefined,
): TriggerFace {
  if (occupancy !== null || primary !== undefined) return 'readings'
  return failure === undefined ? 'glyph' : 'attention'
}

/** The cost section's content: nothing priced yet, or a priced session with the totals behind it. */
export type CostSummary =
  | { readonly state: 'pending' }
  | {
    readonly state: 'priced'
    /** The session's cost as an exact decimal string, in the view's cost currency. */
    readonly amount: string
    /** Every bucket summed, for the section's head figure. */
    readonly totalTokens: number
    /** The buckets the rows list. */
    readonly tokens: UsageTokens
  }

/**
 * Decide what the cost section shows.
 *
 * Pending covers three cases that must all read the same: no usage projection yet, no rates to price
 * it at, and a usage projection whose buckets are all zero. The last one used to put a token total of
 * `0` beside the line saying nothing had been billed — two claims that contradict each other.
 * @param tokens - the session's cumulative token buckets, null before the projection exists.
 * @param rates - the deployment's rates, undefined while the view carries none.
 * @returns the section's content.
 */
export function costSummary(tokens: UsageTokens | null, rates: CostRates | undefined): CostSummary {
  if (tokens === null || rates === undefined) return { state: 'pending' }
  const amount = sessionCost(tokens, rates)
  if (amount === null) return { state: 'pending' }
  const totalTokens = tokens.uncachedInputTokens + tokens.cacheWriteTokens + tokens.cacheReadTokens + tokens.outputTokens
  return { state: 'priced', amount, totalTokens, tokens }
}
