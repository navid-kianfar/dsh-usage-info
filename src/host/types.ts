/**
 * Wire vocabulary of the usage-info surface: what the browser asks for, what it gets back, and the
 * settings the two halves share. Kept free of Host value imports so the Client contribution can name
 * these types without pulling the Host plane in.
 *
 * The amount and failure vocabularies below RESTATE the account-balance capability's own rather than
 * importing it. That is deliberate: this is the wire, and a wire type is a compatibility promise to
 * a browser that may be older than the Host. Re-exporting the capability's union would let a new
 * provider-side failure class reach a browser with no case for it; restating makes adding one a
 * visible edit here, on the same line as the generated schema it changes.
 * @module @deepseek-ai/dsh-usage-info/types
 */

/** One currency's standing, as the browser receives it. */
export interface UsageBalanceAmount {
  /** ISO 4217 code, uppercased. */
  readonly currency: string
  /**
   * Everything spendable right now, as an exact decimal string. Never a number: a JSON number would
   * be an IEEE double by the time it reached the browser, and a rounding artifact in a figure a
   * person reads as money is a defect no display formatting can undo.
   */
  readonly total: string
  /** The granted portion of {@link total}, when the provider separates it. */
  readonly granted?: string
  /** The paid-in portion of {@link total}, when the provider separates it. */
  readonly toppedUp?: string
}

/** One balance reading the browser asked for. */
export interface UsageBalanceRequest {
  /**
   * Ask the provider even when the Host holds a reading still inside its cache window. This is what
   * the panel's manual refresh control sends; the periodic poll sends `false` and is answered from
   * the cache whenever one caller's poll has already paid for the reading.
   */
  readonly refresh: boolean
}

/** A balance reading that succeeded. */
export interface UsageBalanceSuccess {
  readonly ok: true
  /**
   * The provider's own verdict on whether this account can currently serve requests. An account can
   * hold credit and still be unavailable, so a display reports this rather than deriving it.
   */
  readonly available: boolean
  /** One entry per currency held; empty means the account holds nothing, which is a reading. */
  readonly amounts: readonly UsageBalanceAmount[]
  /**
   * Epoch milliseconds at which the provider was asked. The Host serves readings from a cache, so
   * this is the one fact a surface uses to say how old the figure is — there is no separate
   * "was it cached" flag to keep consistent with it.
   */
  readonly fetchedAt: number
}

/**
 * A balance reading that failed, carried as a value rather than thrown.
 *
 * The RPC gateway maps a business exception to the opaque `internal` code with empty details, so a
 * thrown `BalanceError` would reach the browser with its classification erased. Returning the failure
 * keeps `code` intact, which is what lets the panel distinguish "configure a key" from "try again"
 * from "this provider has no balance endpoint, stop asking".
 */
export interface UsageBalanceFailure {
  readonly ok: false
  /** The classified failure; `no-provider` is this endpoint's own, the rest are the capability's. */
  readonly code: UsageBalanceFailureCode
  /** Operator-facing diagnostic; never a secret. */
  readonly message: string
}

/**
 * Failure classes the browser may receive: the account-balance capability's own union, plus
 * `no-provider` for a deployment that mounted no balance provider at all.
 */
export type UsageBalanceFailureCode =
  | 'not-configured'
  | 'unauthorized'
  | 'unsupported'
  | 'provider-unavailable'
  | 'provider-rejected'
  | 'provider-timeout'
  | 'no-provider'

/** Result of one balance reading. */
export type UsageBalanceResult = UsageBalanceSuccess | UsageBalanceFailure

/**
 * Everything the readout needs to render itself and schedule its own polling, answered in one call
 * so a seat does not assemble it from the settings document plus a provider probe.
 */
export interface UsageInfoView {
  /** Whether a balance provider is mounted at all. False means the deployment composed none. */
  readonly balanceAvailable: boolean
  /** The mounted provider's identity, absent when none is mounted. */
  readonly provider?: string
  /** The endpoint that provider will ask, when it reports one; never carries a credential. */
  readonly endpoint?: string
  /** Whether a reading attempted now could reach the provider. */
  readonly ready: boolean
  /** Why {@link ready} is false; absent when ready or when no provider is mounted. */
  readonly detail?: string
  /** Whether the deployment wants the context-occupancy figures shown. */
  readonly showContext: boolean
  /** Whether the deployment wants the session-cost estimate shown. */
  readonly showCost: boolean
  /** Whether the deployment wants the balance shown. */
  readonly showBalance: boolean
  /**
   * The rates a session's cost is estimated at, per one million tokens. Absent while {@link showCost}
   * is false — the Host prices nothing itself, so these are carried to the browser, which is where the
   * token totals already are.
   */
  readonly costRates?: UsageCostRates
  /** ISO 4217 code the rates are quoted in, for the estimate's own currency label. */
  readonly costCurrency: string
  /** How often the browser should re-ask for a balance, in milliseconds. */
  readonly refreshIntervalMs: number
  /**
   * Balance at or below which the readout warns, as an exact decimal string. Compared against each
   * amount's own total in that amount's own currency — the deployment names the one currency it
   * actually bills in. Absent disables the warning.
   */
  readonly lowBalanceThreshold?: string
}

/**
 * Rates one million tokens are priced at, as exact decimal strings.
 *
 * Three rates, not four: cache WRITES have no rate of their own because a provider bills them as
 * cache-miss input, and giving them a separate knob would invite a deployment to double-charge or
 * to price a bucket that never appears in its provider's reports.
 */
export interface UsageCostRates {
  /** Cache-miss input tokens, and cache writes. */
  readonly input: string
  /** Tokens served from the provider's prompt cache. */
  readonly cacheRead: string
  /** Generated tokens, reasoning included. */
  readonly output: string
}

/**
 * The `usage-info` settings section as both halves see it: the Host validates it as its plugin
 * `Config`, and the browser card binds a settings scope to exactly this shape.
 */
export interface UsageInfoSettings {
  /** Whether the readout shows context occupancy for the current session. */
  showContext: boolean
  /** Whether the readout shows what the current session has cost. */
  showCost: boolean
  /** Whether the readout shows the account balance. */
  showBalance: boolean
  /**
   * Rates the session-cost estimate is computed at, as exact decimals per one million tokens. The
   * harness prices nothing, so these are the deployment's own; they are not a bill and the readout
   * labels the figure an estimate.
   */
  readonly costRates: UsageCostRates
  /** ISO 4217 code the cost rates are quoted in. */
  readonly costCurrency: string
  /**
   * How often the browser re-asks for a balance. This is the poll cadence, not the request rate: a
   * poll inside {@link UsageInfoSettings.cacheTtlMs} is answered from the Host's cached reading
   * without touching the provider.
   */
  refreshIntervalMs: number
  /**
   * How long one reading stays servable from the Host cache. Every browser tab shares it, so this —
   * not the poll cadence — is what bounds how often the provider is actually asked.
   */
  cacheTtlMs: number
  /** Exact decimal string at or below which the readout warns; omit to disable the warning. */
  lowBalanceThreshold?: string
}
