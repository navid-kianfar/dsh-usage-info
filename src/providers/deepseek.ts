/**
 * Account-balance provider for DeepSeek's `GET /user/balance`.
 *
 * The API key is addressed by reference, never stored: `apiKeyEnv` names an environment variable and
 * the value is resolved from `ctx.credentials` at the start of every call, so a rotated key reaches
 * the next reading with no restart. That reference defaults to `DEEPSEEK_API_KEY`, the same name the
 * harness's own DeepSeek adapter uses, so a working installation needs no extra configuration to
 * read its own balance.
 *
 * `baseURL` defaults to the public API rather than reading `$DEEPSEEK_BASE_URL`. An out-of-tree
 * plugin has no claim on the launching environment's variables, so pointing this at a private
 * endpoint is an explicit line in the composition.
 * @module @deepseek-ai/dsh-account-balance-deepseek
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials/types'
import { AccountBalanceProvider, BalanceError } from '../balance/index.ts'
import type { AccountBalance, BalanceProviderInfo } from '../balance/types.ts'
import { BALANCE_PATH, classifyHttpFailure, parseBalanceBody } from './deepseek-protocol.ts'

/** Provider identity reported by `describe()`; equal to this package's plugin name. */
const PROVIDER_NAME = 'account-balance-deepseek'

/** Deployment configuration for the DeepSeek balance endpoint. */
export interface Config {
  /**
   * Origin and path prefix of the DeepSeek API, without the `/user/balance` suffix — for example
   * `https://api.deepseek.com`. A trailing slash is accepted and normalized away.
   */
  baseURL: string
  /**
   * Environment-variable name holding the bearer token. This is a credential REFERENCE: the value is
   * resolved per call from the credential seam and never held by this plugin.
   */
  apiKeyEnv: string
  /** Deadline for one reading, from dispatch through the response body. */
  timeoutMs: number
}

/**
 * Strip one trailing slash so `${baseURL}${BALANCE_PATH}` never doubles it.
 * @param baseURL - the configured endpoint prefix.
 * @returns the prefix without a trailing slash.
 */
function normalizeBaseUrl(baseURL: string): string {
  return baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL
}

/**
 * Read the endpoint's error body without letting a second failure mask the first.
 * @param response - the non-OK response.
 * @returns a bounded diagnostic string, empty when the body cannot be read.
 */
async function readErrorBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 512)
  } catch {
    // A body that cannot be read adds nothing to the status the caller already has, and letting this
    // throw would replace a classified provider-rejected failure with a stream error.
    return ''
  }
}

/**
 * Classify a transport-level failure. A caller-initiated abort is rethrown unchanged so cancellation
 * never reads as an outage; the deadline is reported separately from an unreachable endpoint.
 * @param error - the rejection fetch produced.
 * @param signal - the caller's cancellation signal.
 * @param timedOut - whether this provider's own deadline fired.
 * @returns never; always throws.
 */
function throwTransportFailure(error: unknown, signal: AbortSignal, timedOut: boolean): never {
  if (signal.aborted) throw signal.reason
  if (timedOut) throw new BalanceError('provider-timeout', 'balance endpoint did not answer in time', { cause: error })
  throw new BalanceError('provider-unavailable', 'balance endpoint is unreachable', { cause: error })
}

/** Account balance read from the DeepSeek API. */
export class DeepSeekAccountBalance extends AccountBalanceProvider {
  static inject = ['credentials']

  /** Loader validation for the endpoint, credential reference, and deadline. */
  static Config: z<Config> = z.object({
    baseURL: z.string().required(),
    apiKeyEnv: z.string().role('credential-ref').required(),
    timeoutMs: z.number().step(1).min(1).required(),
  })

  private readonly baseURL: string
  private readonly timeoutMs: number
  private readonly apiKeyRef: CredentialRef

  /**
   * @param ctx - registrant context carrying the credential seam.
   * @param config - the validated endpoint, credential reference, and deadline.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.baseURL = normalizeBaseUrl(config.baseURL)
    this.timeoutMs = config.timeoutMs
    this.apiKeyRef = credentialRef(config.apiKeyEnv)
  }

  /**
   * Report identity, endpoint, and whether the configured credential currently resolves.
   * @returns the provider's identity and readiness; never the key itself.
   */
  async describe(): Promise<BalanceProviderInfo> {
    const base = { provider: PROVIDER_NAME, endpoint: `${this.baseURL}${BALANCE_PATH}` }
    const info = await this.ctx.credentials.describe(this.apiKeyRef)
    return info.configured
      ? { ...base, ready: true }
      : { ...base, ready: false, detail: `no value for ${this.apiKeyRef}` }
  }

  /**
   * Ask DeepSeek for the account's current balance.
   * @param signal - caller-owned cancellation.
   * @returns the reading, stamped with the instant the request was issued.
   */
  async read(signal: AbortSignal): Promise<AccountBalance> {
    const hit = await this.ctx.credentials.resolve(this.apiKeyRef)
    if (hit === undefined) {
      throw new BalanceError('not-configured', `no value for ${this.apiKeyRef}`)
    }

    // Stamped before dispatch, so a slow reading reports the age of the question rather than
    // claiming to describe the moment the answer happened to arrive.
    const fetchedAt = Date.now()
    const timeout = AbortSignal.timeout(this.timeoutMs)
    let response: Response
    try {
      response = await fetch(`${this.baseURL}${BALANCE_PATH}`, {
        method: 'GET',
        headers: { 'authorization': `Bearer ${hit.value}`, 'accept': 'application/json' },
        signal: AbortSignal.any([signal, timeout]),
      })
    } catch (error) {
      throwTransportFailure(error, signal, timeout.aborted)
    }

    if (!response.ok) throw classifyHttpFailure(response.status, await readErrorBody(response))

    let payload: unknown
    try {
      payload = await response.json()
    } catch (error) {
      throw new BalanceError('provider-rejected', 'balance endpoint returned a non-JSON body', { cause: error })
    }
    return parseBalanceBody(payload, fetchedAt)
  }
}

export default DeepSeekAccountBalance
