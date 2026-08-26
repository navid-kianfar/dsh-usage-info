/**
 * The usage-info surface's Consumer half on the Host: one Remote namespace the browser reads its
 * balance through, and the settings section that owns the deployment's readout preferences.
 *
 * Only the balance half is here. Context occupancy — how full the current session's context window
 * is — is already a durable session projection the browser reads directly, so routing it through
 * this endpoint would add a round trip, a second copy of the same numbers, and a way for the two to
 * disagree. What the Host owns is the half the browser structurally cannot do: the balance endpoint
 * needs an API key, and a key in a browser is a leaked key.
 *
 * Nothing here is model-facing. A balance reading is operator information that never enters a prompt,
 * so the capability adds no tool, no prompt, and no session event.
 * @module @deepseek-ai/dsh-usage-info
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: the credential seam's `credentials/reference-updated` Events merge, listened to below.
// Named here rather than inherited from a sibling module's import, because the listener's key only
// typechecks while that declaration is loaded and nothing else in this file pulls it in.
import type {} from '@deepseek-ai/dsh-credentials/types'
import { isBalanceError, type AccountBalanceProvider } from '../balance/index.ts'
import { BalanceCache } from './cache.ts'
import type {
  UsageBalanceRequest,
  UsageBalanceResult,
  UsageInfoSettings,
  UsageInfoView,
} from './types.ts'

export type * from './types.ts'

/**
 * The settings namespace both halves of this plugin address; the browser card joins on it.
 *
 * Hyphenated, while the service key below is not: settings namespaces are a kebab-case grammar, and
 * a Remote namespace is read as `ctx.remote.usageInfo.…` and so must be an identifier.
 */
export const USAGE_INFO_SETTINGS_NAMESPACE = settingsNamespace('usage-info')

/** An exact decimal quantity: optional sign, digits, optional fraction. */
const DECIMAL = /^-?\d+(?:\.\d+)?$/u

/** Deployment configuration for the usage readout; the `usage-info` settings section's own shape. */
export type Config = UsageInfoSettings

declare module '@deepseek-ai/cordis' {
  interface Context {
    usageInfo: UsageInfoService
  }
}

/**
 * Reject a section this service could not act on, for the two constraints its schema cannot express.
 *
 * Called from the constructor as well as from the settings hook, and that is the point: the settings
 * seam is optional, so a composition without it would never run the hook — and these constraints come
 * straight off the composition file, where being wrong is a load-time mistake that must fail loudly
 * rather than a running deployment that quietly polls into a stale cache.
 * @param value - the resolved section, schema-valid by construction.
 */
function validateConfig(value: Config): void {
  if (value.lowBalanceThreshold !== undefined
    && value.lowBalanceThreshold !== ''
    && !DECIMAL.test(value.lowBalanceThreshold)) {
    throw new Error(
      `usage-info: lowBalanceThreshold must be an exact decimal string, got "${value.lowBalanceThreshold}"`,
    )
  }
  if (value.cacheTtlMs > value.refreshIntervalMs) {
    throw new Error(
      `usage-info: cacheTtlMs (${value.cacheTtlMs}) above refreshIntervalMs (${value.refreshIntervalMs})`
      + ' would hold every poll on a reading already older than the cadence it was scheduled at',
    )
  }
}

/** What this service holds while a balance provider is mounted; discarded together when one is not. */
interface BoundProvider {
  readonly provider: AccountBalanceProvider
  readonly cache: BalanceCache
}

/** Host-side balance endpoint and usage-readout settings owner. */
export class UsageInfoService extends TypertRemoteService {
  /** Loader validation for the two visibility flags, the two cadences, and the warning threshold. */
  static Config: z<Config> = z.object({
    showContext: z.boolean().required(),
    showBalance: z.boolean().required(),
    refreshIntervalMs: z.number().step(1).min(1_000).required(),
    cacheTtlMs: z.number().step(1).min(0).required(),
    lowBalanceThreshold: z.string(),
  })

  private source: () => Config

  /**
   * The mounted provider and its cache, or undefined while none is mounted.
   *
   * The pair is one field because it must be replaced as one. A cache outliving its provider would
   * answer a new account's question with the previous account's money, and the fiber below is what
   * guarantees it cannot: the cache is created when a provider mounts and dropped when it goes.
   */
  private bound: BoundProvider | undefined

  /**
   * @param ctx - Host context; the balance provider is resolved optionally so a deployment without
   * one still serves a view explaining that.
   * @param config - the composition-layer readout preferences.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'usageInfo')
    validateConfig(config)
    this.source = () => config
    installSettingsSection(ctx, USAGE_INFO_SETTINGS_NAMESPACE, UsageInfoService.Config, config, {
      setSource: (current) => { this.source = current },
      // Nothing is derived from the section: both cadences and both flags are read inside a call, so
      // a committed change reaches the next request with no registration to rebuild.
      onChange: () => {},
      validate: validateConfig,
    })

    ctx.inject(['accountBalance'], (bound) => {
      const cache = new BalanceCache(signal => bound.accountBalance.read(signal))
      const entry: BoundProvider = { provider: bound.accountBalance, cache }
      this.bound = entry
      // Any stored credential edit drops the reading. The provider owns its own credential reference
      // and does not publish it, so this cannot narrow to that one ref — and it does not need to: the
      // worst an unrelated edit costs is one extra reading, while the case it prevents is showing the
      // previous key's account balance after someone switched accounts.
      bound.on('credentials/reference-updated', () => { cache.invalidate() })
      bound.effect(() => () => {
        // Only clear what this fiber installed: on a provider swap the replacement's fiber has
        // already run, and blindly clearing here would drop the live entry instead of the dead one.
        if (this.bound === entry) this.bound = undefined
      })
    })
  }

  /**
   * Describe what the readout needs to render itself and schedule its polling: the mounted
   * provider's readiness, plus the deployment's visibility flags, cadence, and warning threshold.
   * @returns the usage-info view; `balanceAvailable: false` when no provider is mounted.
   */
  @Remote('describe')
  async describe(): Promise<UsageInfoView> {
    const config = this.source()
    const preferences = {
      showContext: config.showContext,
      showBalance: config.showBalance,
      refreshIntervalMs: config.refreshIntervalMs,
      // Empty is how the settings card clears the warning, and it is normalized to absent HERE so
      // that "no threshold" has exactly one spelling on the wire. A browser handed `''` would have to
      // compare a balance against nothing.
      ...config.lowBalanceThreshold === undefined || config.lowBalanceThreshold === ''
        ? {}
        : { lowBalanceThreshold: config.lowBalanceThreshold },
    }
    const bound = this.bound
    if (bound === undefined) return { balanceAvailable: false, ready: false, ...preferences }
    const info = await bound.provider.describe()
    return {
      balanceAvailable: true,
      provider: info.provider,
      ...info.endpoint === undefined ? {} : { endpoint: info.endpoint },
      ready: info.ready,
      ...info.detail === undefined ? {} : { detail: info.detail },
      ...preferences,
    }
  }

  /**
   * Read the account's balance, from the shared cache unless the caller asked for a fresh reading.
   *
   * Every failure is returned rather than thrown: the gateway erases a business exception's
   * classification, and the browser's next action depends on which class it was.
   * @param request - whether to bypass the cache window.
   * @param signal - gateway-supplied cancellation for the caller's abandoned request.
   * @returns the reading, or a classified failure.
   */
  @Remote('balance')
  async balance(request: UsageBalanceRequest, signal: AbortSignal): Promise<UsageBalanceResult> {
    const bound = this.bound
    if (bound === undefined) {
      return { ok: false, code: 'no-provider', message: 'no account-balance provider is mounted' }
    }
    try {
      const reading = await bound.cache.get(this.source().cacheTtlMs, request.refresh, signal)
      return {
        ok: true,
        available: reading.available,
        amounts: reading.amounts.map(amount => ({
          currency: amount.currency,
          total: amount.total,
          ...amount.granted === undefined ? {} : { granted: amount.granted },
          ...amount.toppedUp === undefined ? {} : { toppedUp: amount.toppedUp },
        })),
        fetchedAt: reading.fetchedAt,
      }
    } catch (error) {
      if (isBalanceError(error)) return { ok: false, code: error.code, message: error.message }
      throw error
    }
  }
}

export default UsageInfoService
