/**
 * Account-balance Service Definition. `ctx.accountBalance` defines WHAT a balance reading is — the
 * spendable standing of the account paying for model calls — without saying HOW it is obtained; a
 * provider plugin supplies the mechanism.
 *
 * The capability is deliberately narrow. A reading is a whole answer about one account at one
 * instant: the definition has no history, no cost attribution, and no per-request accounting,
 * because those need durable records this capability does not keep. It also has no spend verb of any
 * kind — reading a balance and moving money are different authorities, and only the first belongs in
 * a status display.
 * @module @deepseek-ai/dsh-account-balance
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { AccountBalance, BalanceProviderInfo } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    accountBalance: AccountBalanceProvider
  }
}

/**
 * Stable failure classes every provider maps its own vocabulary onto. Consumers switch on `code`
 * rather than parsing messages, so a provider swap cannot change how a caller reacts.
 *
 * Two classes a UI must keep apart from the rest: `not-configured` means the deployment mounted a
 * provider that still lacks a credential, so the fix is configuration rather than a retry; and
 * `unsupported` means the provider is configured correctly and its API simply publishes no balance,
 * so there is no fix at all and the surface should stop asking.
 */
export type BalanceErrorCode =
  | 'not-configured'
  | 'unauthorized'
  | 'unsupported'
  | 'provider-unavailable'
  | 'provider-rejected'
  | 'provider-timeout'

/** One classified balance failure. */
export class BalanceError extends Error {
  override readonly name = 'BalanceError'

  /**
   * Create one classified failure.
   * @param code - stable failure class the caller switches on.
   * @param message - provider diagnostic retained as the Error message.
   * @param options - standard Error options, carrying the provider cause when one exists.
   */
  constructor(readonly code: BalanceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

/**
 * Narrow an unknown rejection to this capability's classified failure.
 * @param value - the caught value.
 * @returns whether the value is a {@link BalanceError}.
 */
export function isBalanceError(value: unknown): value is BalanceError {
  return value instanceof BalanceError
}

/**
 * The account-balance capability's Service Definition.
 *
 * A provider extends this class and registers itself as `ctx.accountBalance`. Exactly one provider
 * is mounted at a time — the Cordis service key is the arbiter, so a composition that mounts two
 * fails loudly at load rather than silently preferring one.
 */
export abstract class AccountBalanceProvider extends Service {
  /**
   * Bind the provider to the capability's service key.
   * @param ctx - registrant context the provider was applied to.
   */
  constructor(ctx: Context) {
    super(ctx, 'accountBalance')
  }

  /**
   * Read the account's current balance.
   *
   * Implementations reject with {@link BalanceError}; every other rejection is a defect. An account
   * that holds nothing returns empty `amounts` rather than failing, because "no credit" is a reading
   * a surface renders differently from "could not read".
   *
   * Implementations do not cache: this method means "ask the provider now". Caching is the calling
   * Consumer's decision, because only the Consumer knows how many surfaces share one reading and how
   * stale each of them may be.
   * @param signal - caller-owned cancellation; implementations abandon in-flight work when it fires.
   * @returns the account's standing, stamped with the instant the provider was asked.
   */
  abstract read(signal: AbortSignal): Promise<AccountBalance>

  /**
   * Report what this provider is and whether it can run right now.
   *
   * Configuration surfaces call this to tell "no provider mounted" apart from "mounted but missing a
   * key", without spending a reading. It reports readiness, never a secret.
   * @returns the provider's identity and current readiness.
   */
  abstract describe(): Promise<BalanceProviderInfo>
}
