/**
 * Pure readings of the context-occupancy projections.
 *
 * These figures come from the harness's own token meter, which publishes them as durable session
 * projections. The browser therefore computes no token counts of its own — it reads what the Host
 * already folded — and this module only turns those values into what a readout displays.
 * @module @achasoft/dsh-usage-info/client/context
 */

import type { ContextBreakdownProjection, ContextPressureProjection } from '@deepseek-ai/dsh-token-meter/client'

/** How full the model's context window is, once both halves of the fraction are known. */
export interface ContextOccupancy {
  /** Whole percent, clamped to 100 — a provider can price a prompt above the advertised capacity. */
  readonly percent: number
  /** Tokens the next request's prompt is expected to cost. */
  readonly usedTokens: number
  /** The route's advertised capacity. */
  readonly contextWindow: number
}

/** One composition row of the next request's prompt. */
export interface ContextPart {
  /** Which part of the prompt this is. */
  readonly key: 'systemTokens' | 'toolsTokens' | 'messageTokens'
  /** Heuristic tokens for that part. */
  readonly tokens: number
  /** Share of the composition, as a whole percent of the three parts summed. */
  readonly percent: number
}

/**
 * Read occupancy from the pressure projection.
 *
 * `projectedTokens` is preferred over `pressureTokens` because it answers for the NEXT request:
 * the provider-anchored sample plus the surface's movement since. That is what a person is deciding
 * against, and it is the only one of the two that reacts to a compaction — compaction reports no
 * usage of its own, so `pressureTokens` alone would keep showing a full context after one.
 * @param pressure - the `contextPressure` projection value, absent before any provider usage.
 * @returns the occupancy, or null while either half of the fraction is unknown or the capacity is
 * not a positive number.
 */
export function contextOccupancy(pressure: ContextPressureProjection | undefined): ContextOccupancy | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  // A route that reports no usable capacity has not told us the denominator any more than one that
  // reports none: 0 / 0 renders as "NaN%" and n / 0 as a full ring, both of which read as a fact.
  if (!Number.isFinite(pressure.contextWindow) || pressure.contextWindow <= 0) return null
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

/**
 * Split the prompt into its three heuristic parts.
 *
 * These are shares of a composition, never a total. The meter's fixed density estimate systematically
 * underprices CJK text and JSON schemas, so the three will not sum to the provider-anchored
 * occupancy — which is exactly why occupancy is anchored and this is not. A caller presents these as
 * proportions and takes its total from {@link contextOccupancy}.
 * @param breakdown - the `contextBreakdown` projection value, absent before any request.
 * @returns the parts in prompt order, or an empty list when nothing has been priced yet.
 */
export function contextParts(breakdown: ContextBreakdownProjection | undefined): readonly ContextPart[] {
  if (breakdown === undefined) return []
  const total = breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
  if (total === 0) return []
  return (['systemTokens', 'toolsTokens', 'messageTokens'] as const).map(key => ({
    key,
    tokens: breakdown[key],
    percent: breakdown[key] / total * 100,
  }))
}

/**
 * Compact token count: `840`, `12.4K`, `1.2M`.
 *
 * Matches the harness's own stats strip so a person reads one vocabulary across both surfaces. One
 * decimal below 100 of a unit and none above it keeps every value four characters or fewer, which is
 * what lets these sit inline without the row reflowing as the number grows.
 * @param n - a token count.
 * @returns the display string.
 */
export function formatTokens(n: number): string {
  const scaled = (value: number): string =>
    value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}
