/**
 * Pure value types of the account-balance capability, free of Cordis value imports so a consumer can
 * name what it receives without loading the service.
 * @module @deepseek-ai/dsh-account-balance/types
 */

/**
 * One currency's standing on an account.
 *
 * Every figure is a decimal STRING, never a number. Balances are exact decimal quantities and IEEE
 * doubles are not: `0.1 + 0.2` is the canonical demonstration, and a rounding artifact in a figure a
 * person reads as money is a defect no display formatting can undo. Providers report these as
 * strings too, so the value crosses this capability, the RPC gateway, and the browser without ever
 * entering a binary float.
 */
export interface BalanceAmount {
  /** ISO 4217 code the provider reported, uppercased (`CNY`, `USD`). */
  readonly currency: string
  /** Everything spendable right now: granted credit plus paid credit. */
  readonly total: string
  /** The promotional or granted portion of {@link total}, when the provider separates it. */
  readonly granted?: string
  /** The paid-in portion of {@link total}, when the provider separates it. */
  readonly toppedUp?: string
}

/** One reading of an account's balance. */
export interface AccountBalance {
  /**
   * The provider's own verdict on whether this account can currently serve requests. False with a
   * non-zero {@link amounts} is a real state — an account can hold credit and still be suspended —
   * so a display reports it rather than deriving availability from the figures.
   */
  readonly available: boolean
  /**
   * One entry per currency the account holds, in the provider's own order. Empty means the provider
   * answered successfully and the account holds nothing, which is a reading rather than a failure.
   */
  readonly amounts: readonly BalanceAmount[]
  /**
   * Epoch milliseconds at which the provider was actually asked. A consumer may serve this reading
   * from a cache, so the reading carries its own age instead of the consumer assuming "now".
   */
  readonly fetchedAt: number
}

/** What a mounted balance provider is, and whether it can run right now. */
export interface BalanceProviderInfo {
  /**
   * Stable provider identifier, equal to the providing plugin's registered name. A configuration
   * surface displays it and keys help text on it.
   */
  readonly provider: string
  /** The endpoint this provider will ask, when it has one; never carries a credential. */
  readonly endpoint?: string
  /**
   * Whether a reading attempted now could reach the provider. False means configuration is
   * incomplete — typically a missing credential — and {@link detail} says which.
   */
  readonly ready: boolean
  /** Human-readable reason {@link ready} is false; never a secret, and absent when ready. */
  readonly detail?: string
}
