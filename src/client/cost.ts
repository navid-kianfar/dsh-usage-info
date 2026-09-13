/**
 * What the current session has cost so far, in exact decimal money.
 *
 * The harness publishes the session's cumulative token totals as a durable projection and prices
 * nothing: there is no rate, no currency, and no cost field anywhere in it. So the rates are the
 * deployment's own, and this module is only the arithmetic that turns four token buckets and three
 * rates into one figure.
 *
 * The arithmetic is exact and integer. `tokens × 0.28 / 1e6` in binary floating point drifts in the
 * last places, and a figure someone reads as money is the last place to accept that — the same reason
 * {@link ./money.ts} never parses a balance into a Number.
 * @module @achasoft/dsh-usage-info/client/cost
 */

/** The session's cumulative token buckets, as the harness's token meter publishes them. */
export interface UsageTokens {
  /** Input tokens the provider had to read in full. */
  readonly uncachedInputTokens: number
  /** Input tokens served from the provider's prompt cache. */
  readonly cacheReadTokens: number
  /** Input tokens the provider stored into its prompt cache. */
  readonly cacheWriteTokens: number
  /** Generated tokens, reasoning tokens included. */
  readonly outputTokens: number
}

/** What one million tokens of each kind is priced at, as exact decimals in one currency. */
export interface CostRates {
  /**
   * Cache-miss input tokens. Cache WRITES are billed at this rate too: a provider charges for the
   * tokens it had to read, and a prefix being stored is read in full on the request that stores it.
   */
  readonly input: string
  /** Tokens served from the provider's prompt cache. */
  readonly cacheRead: string
  /** Generated tokens. */
  readonly output: string
}

/** Decimal places the arithmetic is exact to; a money figure is rounded half-up at the sixth. */
const SCALE = 1_000_000n

/**
 * Read one exact decimal string as a scaled integer.
 *
 * Digits past {@link SCALE} round half-up rather than being truncated, so a rate quoted to more
 * places than the money it produces can resolve is still read as the nearest representable value.
 * @param value - an exact decimal string, already validated where it entered the system.
 * @returns the value scaled by {@link SCALE}.
 */
function scaled(value: string): bigint {
  const negative = value.startsWith('-')
  const unsigned = negative || value.startsWith('+') ? value.slice(1) : value
  const dot = unsigned.indexOf('.')
  const int = dot < 0 ? unsigned : unsigned.slice(0, dot)
  const frac = dot < 0 ? '' : unsigned.slice(dot + 1)
  let result = BigInt(int === '' ? '0' : int) * SCALE
    + BigInt(frac.slice(0, 6).padEnd(6, '0'))
  if (Number(frac.slice(6, 7) || '0') >= 5) result += 1n
  return negative ? -result : result
}

/**
 * Render a scaled integer as an exact decimal string, with no trailing zeros and no separators.
 * @param value - money scaled by {@link SCALE}.
 * @returns the decimal string.
 */
function decimal(value: bigint): string {
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const whole = magnitude / SCALE
  const frac = magnitude % SCALE
  const sign = negative ? '-' : ''
  if (frac === 0n) return `${sign}${whole}`
  return `${sign}${whole}.${frac.toString().padStart(6, '0').replace(/0+$/u, '')}`
}

/**
 * Estimate what the session in view has cost, from its cumulative usage and the deployment's rates.
 *
 * The result is the whole session's spend, not the last request's: the projection these buckets come
 * from sums every settled attempt in the durable log, retries included, which is also what a provider
 * bills for.
 * @param tokens - the session's cumulative token buckets.
 * @param rates - the deployment's rates per one million tokens.
 * @returns the cost as an exact decimal string, or null before anything has been billed.
 */
export function sessionCost(tokens: UsageTokens, rates: CostRates): string | null {
  // Every bucket empty is not a cost of zero, it is a session whose first request has not been billed
  // yet: the readout says "pending" for that, and a money figure of 0.00 would be a different claim.
  // Tokens billed at a rate of zero are the other case, and they do read as a figure of zero.
  if (tokens.uncachedInputTokens + tokens.cacheWriteTokens + tokens.cacheReadTokens + tokens.outputTokens === 0) {
    return null
  }
  const numerator = BigInt(tokens.uncachedInputTokens + tokens.cacheWriteTokens) * scaled(rates.input)
    + BigInt(tokens.cacheReadTokens) * scaled(rates.cacheRead)
    + BigInt(tokens.outputTokens) * scaled(rates.output)
  const micro = (numerator + SCALE / 2n) / SCALE
  return decimal(micro)
}
