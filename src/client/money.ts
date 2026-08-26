/**
 * Exact decimal handling for balance figures, and the age of a reading.
 *
 * Every function here works on the decimal STRING the provider sent. Nothing converts a balance to a
 * number: `Number('0.1') + Number('0.2')` is the standard demonstration of why, and a figure a person
 * reads as their money is the last place to accept that class of error. Comparison is digit-wise and
 * formatting only inserts separators, so the digits displayed are always the digits received.
 * @module @achasoft/dsh-usage-info/client/money
 */

/** One decimal string taken apart into the pieces a comparison needs. */
interface Decimal {
  readonly negative: boolean
  /** Integer digits with leading zeros removed; `0` for a value below one. */
  readonly int: string
  /** Fraction digits with trailing zeros removed; empty for a whole number. */
  readonly frac: string
}

/**
 * Split one exact decimal string into sign, integer digits, and fraction digits.
 *
 * The input is already known to be a decimal: it is validated where it enters the system, at the
 * provider's JSON parse and at the settings threshold. This only normalizes away the zeros that
 * carry no value, so `1.50`, `01.5`, and `1.5` compare equal.
 * @param value - an exact decimal string.
 * @returns its normalized pieces.
 */
function split(value: string): Decimal {
  const negative = value.startsWith('-')
  const unsigned = negative || value.startsWith('+') ? value.slice(1) : value
  const dot = unsigned.indexOf('.')
  const rawInt = dot < 0 ? unsigned : unsigned.slice(0, dot)
  const rawFrac = dot < 0 ? '' : unsigned.slice(dot + 1)
  const int = rawInt.replace(/^0+(?=\d)/u, '')
  return { negative, int, frac: rawFrac.replace(/0+$/u, '') }
}

/**
 * Compare two exact decimal strings by their digits.
 * @param left - an exact decimal string.
 * @param right - an exact decimal string.
 * @returns negative when left is smaller, positive when larger, zero when equal in value.
 */
export function compareDecimal(left: string, right: string): number {
  const a = split(left)
  const b = split(right)
  // Negative zero is still zero: comparing signs first would otherwise rank `-0.0` below `0`.
  const aZero = a.int === '0' && a.frac === ''
  const bZero = b.int === '0' && b.frac === ''
  if (aZero && bZero) return 0
  if (a.negative !== b.negative) return a.negative ? -1 : 1
  const sign = a.negative ? -1 : 1
  if (a.int.length !== b.int.length) return a.int.length < b.int.length ? -sign : sign
  if (a.int !== b.int) return a.int < b.int ? -sign : sign
  const width = Math.max(a.frac.length, b.frac.length)
  const aFrac = a.frac.padEnd(width, '0')
  const bFrac = b.frac.padEnd(width, '0')
  if (aFrac === bFrac) return 0
  return aFrac < bFrac ? -sign : sign
}

/**
 * Whether a balance has fallen to the deployment's warning threshold.
 * @param total - the amount's total, an exact decimal string.
 * @param threshold - the configured warning level, or undefined to disable warning.
 * @returns whether the readout should warn about this amount.
 */
export function isLowBalance(total: string, threshold: string | undefined): boolean {
  return threshold !== undefined && compareDecimal(total, threshold) <= 0
}

/**
 * Group a decimal string's integer digits for display, leaving every digit exactly as received.
 * @param value - an exact decimal string.
 * @returns the same value with thousands separators in the integer part.
 */
export function formatDecimal(value: string): string {
  const negative = value.startsWith('-')
  const unsigned = negative || value.startsWith('+') ? value.slice(1) : value
  const dot = unsigned.indexOf('.')
  const int = dot < 0 ? unsigned : unsigned.slice(0, dot)
  const frac = dot < 0 ? '' : unsigned.slice(dot)
  const grouped = int.replace(/\B(?=(?:\d{3})+$)/gu, ',')
  return `${negative ? '-' : ''}${grouped}${frac}`
}

/**
 * Render one amount as a currency code and a figure.
 *
 * The ISO code is used rather than a symbol on purpose. The two currencies this plugin's shipped
 * provider reports are CNY and USD, and `¥` is read as yen at least as often as yuan — a status
 * readout that can be misread as the wrong currency is worse than one that spends three characters
 * being unambiguous.
 * @param currency - ISO 4217 code.
 * @param total - the amount's total, an exact decimal string.
 * @returns the display string.
 */
export function formatAmount(currency: string, total: string): string {
  return `${currency} ${formatDecimal(total)}`
}

/** How old a reading is, in the unit a person would say it in. */
export interface ReadingAge {
  /** Which unit {@link ReadingAge.value} counts; `now` counts nothing. */
  readonly unit: 'now' | 'minutes' | 'hours' | 'days'
  /** Whole units elapsed; always 0 for `now`. */
  readonly value: number
}

/**
 * Describe how old a reading is, leaving the words to the caller's dictionary.
 *
 * A reading stamped in the future reads as `now` rather than as a negative age: the Host's clock and
 * the browser's are different clocks, and a few seconds of skew is not information.
 * @param fetchedAt - epoch milliseconds the provider was asked.
 * @param now - epoch milliseconds at render.
 * @returns the age in the largest unit that yields a whole number.
 */
export function readingAge(fetchedAt: number, now: number): ReadingAge {
  const seconds = Math.floor((now - fetchedAt) / 1_000)
  if (seconds < 60) return { unit: 'now', value: 0 }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return { unit: 'minutes', value: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { unit: 'hours', value: hours }
  return { unit: 'days', value: Math.floor(hours / 24) }
}
