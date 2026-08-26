/**
 * Wire vocabulary of DeepSeek's `GET /user/balance`: how its JSON body becomes an
 * {@link AccountBalance}, and how its HTTP statuses become classified failures.
 *
 * Kept separate from the provider so both halves are pure functions of a response — the transport is
 * the only part that needs a network to exercise.
 * @module @deepseek-ai/dsh-account-balance-deepseek/protocol
 */

import { BalanceError } from '../balance/index.ts'
import type { AccountBalance, BalanceAmount } from '../balance/types.ts'

/** Path appended to the configured base URL; the endpoint is account-scoped, not model-scoped. */
export const BALANCE_PATH = '/user/balance'

/**
 * An exact decimal quantity as the provider writes it: optional sign, digits, optional fraction.
 *
 * Exponent notation is rejected on purpose. Nothing in this API emits it, and accepting it would
 * mean a figure whose display depends on parsing it as a float — the one thing this capability
 * refuses to do with money.
 */
const DECIMAL = /^-?\d+(?:\.\d+)?$/u

/**
 * Read one required decimal field.
 * @param source - the balance entry object.
 * @param field - the wire field name.
 * @returns the field verbatim, already known to be an exact decimal.
 */
function decimal(source: Record<string, unknown>, field: string): string {
  const value = source[field]
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new BalanceError('provider-rejected', `balance field "${field}" is not a decimal string`)
  }
  return value
}

/**
 * Read one optional decimal field.
 * @param source - the balance entry object.
 * @param field - the wire field name.
 * @returns the field verbatim, or undefined when the provider omitted it.
 */
function optionalDecimal(source: Record<string, unknown>, field: string): string | undefined {
  return source[field] === undefined ? undefined : decimal(source, field)
}

/**
 * Narrow an unknown JSON value to an object without inheriting `Object.prototype` members.
 * @param value - the parsed JSON value.
 * @returns whether it is a plain JSON object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Convert one `balance_infos` entry.
 * @param entry - one element of the wire array.
 * @returns the capability's amount for that currency.
 */
function parseAmount(entry: unknown): BalanceAmount {
  if (!isObject(entry)) throw new BalanceError('provider-rejected', 'balance entry is not an object')
  const currency = entry['currency']
  if (typeof currency !== 'string' || currency.length === 0) {
    throw new BalanceError('provider-rejected', 'balance entry has no currency')
  }
  const granted = optionalDecimal(entry, 'granted_balance')
  const toppedUp = optionalDecimal(entry, 'topped_up_balance')
  return {
    currency: currency.toUpperCase(),
    total: decimal(entry, 'total_balance'),
    ...granted === undefined ? {} : { granted },
    ...toppedUp === undefined ? {} : { toppedUp },
  }
}

/**
 * Convert one successful `GET /user/balance` body.
 *
 * The body is external JSON, so every field is checked rather than trusted: a silently mistyped
 * figure would reach a person as a number they believe is their money.
 * @param payload - the parsed response body.
 * @param fetchedAt - epoch milliseconds at which the request was issued.
 * @returns the reading, stamped with when the provider was asked.
 */
export function parseBalanceBody(payload: unknown, fetchedAt: number): AccountBalance {
  if (!isObject(payload)) throw new BalanceError('provider-rejected', 'balance body is not an object')
  const available = payload['is_available']
  if (typeof available !== 'boolean') {
    throw new BalanceError('provider-rejected', 'balance body has no is_available flag')
  }
  const infos = payload['balance_infos']
  if (!Array.isArray(infos)) {
    throw new BalanceError('provider-rejected', 'balance body has no balance_infos array')
  }
  return { available, amounts: infos.map(parseAmount), fetchedAt }
}

/**
 * Classify one non-OK response.
 *
 * `404` is read as {@link BalanceError} `unsupported` rather than as an outage: the configured base
 * URL answered, it simply publishes no balance endpoint. That is the expected reply from an
 * OpenAI-compatible gateway standing in for DeepSeek, and it is permanent — a surface that told the
 * user to retry would have it retry forever.
 * @param status - the response status code.
 * @param body - a bounded excerpt of the error body, for the diagnostic.
 * @returns the classified failure to throw.
 */
export function classifyHttpFailure(status: number, body: string): BalanceError {
  const detail = body.length === 0 ? '' : `: ${body}`
  if (status === 401 || status === 403) {
    return new BalanceError('unauthorized', `balance endpoint rejected the API key (${status})${detail}`)
  }
  if (status === 404) {
    return new BalanceError('unsupported', `balance endpoint is not served at this base URL (404)${detail}`)
  }
  if (status === 408 || status === 504) {
    return new BalanceError('provider-timeout', `balance endpoint timed out (${status})${detail}`)
  }
  if (status === 429 || status >= 500) {
    return new BalanceError('provider-unavailable', `balance endpoint is unavailable (${status})${detail}`)
  }
  return new BalanceError('provider-rejected', `balance endpoint returned ${status}${detail}`)
}
