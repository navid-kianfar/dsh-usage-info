import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { UsageInfoService } from '../src/host/index.ts'
import { DeepSeekAccountBalance } from '../src/providers/deepseek.ts'
import { MemoryCredentials } from './memory-credentials.ts'
import type { Config as UsageConfig } from '../src/host/index.ts'
import type { UsageBalanceResult } from '../src/host/types.ts'

/** The composition defaults, mirroring cordis.patch.yml. */
const USAGE: UsageConfig = {
  showContext: true,
  showCost: true,
  showBalance: true,
  costRates: { input: '0.28', cacheRead: '0.028', output: '0.42' },
  costCurrency: 'USD',
  refreshIntervalMs: 300_000,
  cacheTtlMs: 240_000,
}

const PROVIDER = { baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY', timeoutMs: 15_000 }

/** One well-formed provider response. */
const okBody = {
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
  ],
}

/** Install a fetch double for the duration of one test. */
function stubFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(impl(String(input), init ?? {})))
  vi.stubGlobal('fetch', spy)
  return spy
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Boot a Host with the consumer mounted, and optionally the provider and a seeded key. */
async function boot(options: {
  provider?: boolean
  key?: string
  usage?: Partial<UsageConfig>
} = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials, options.key === undefined ? {} : { DEEPSEEK_API_KEY: options.key })
  if (options.provider === true) await ctx.plugin(DeepSeekAccountBalance, PROVIDER)
  await ctx.plugin(UsageInfoService, { ...USAGE, ...options.usage })
  return ctx
}

afterEach(() => { vi.unstubAllGlobals() })

describe('describe()', () => {
  it('reports no provider, but still serves the readout preferences', async () => {
    const ctx = await boot()
    expect(await ctx.usageInfo.describe()).toEqual({
      balanceAvailable: false,
      ready: false,
      showContext: true,
      showCost: true,
      costRates: { input: '0.28', cacheRead: '0.028', output: '0.42' },
      costCurrency: 'USD',
      showBalance: true,
      refreshIntervalMs: 300_000,
    })
  })

  it('reports a mounted provider as not ready while its credential is unset', async () => {
    const ctx = await boot({ provider: true })
    const view = await ctx.usageInfo.describe()
    expect(view.balanceAvailable).toBe(true)
    expect(view.provider).toBe('account-balance-deepseek')
    expect(view.endpoint).toBe('https://api.deepseek.com/user/balance')
    expect(view.ready).toBe(false)
    expect(view.detail).toContain('DEEPSEEK_API_KEY')
  })

  it('reports ready once the credential resolves, without disclosing it', async () => {
    const ctx = await boot({ provider: true, key: 'sk-secret' })
    const view = await ctx.usageInfo.describe()
    expect(view.ready).toBe(true)
    expect(JSON.stringify(view)).not.toContain('sk-secret')
  })

  it('passes a configured warning threshold through to the browser', async () => {
    const ctx = await boot({ usage: { lowBalanceThreshold: '10.00' } })
    expect((await ctx.usageInfo.describe()).lowBalanceThreshold).toBe('10.00')
  })

  it('normalizes a cleared threshold to absent, so "no warning" has one spelling', async () => {
    const ctx = await boot({ usage: { lowBalanceThreshold: '' } })
    expect(await ctx.usageInfo.describe()).not.toHaveProperty('lowBalanceThreshold')
  })

  it('withholds the rates while the estimate is off, so nothing can price a hidden figure', async () => {
    const ctx = await boot({ usage: { showCost: false } })
    const view = await ctx.usageInfo.describe()
    expect(view.showCost).toBe(false)
    expect(view).not.toHaveProperty('costRates')
  })
})

describe('balance()', () => {
  const read = (ctx: Context, refresh = false): Promise<UsageBalanceResult> =>
    ctx.usageInfo.balance({ refresh }, new AbortController().signal)

  it('answers with no-provider rather than throwing when none is mounted', async () => {
    const ctx = await boot()
    expect(await read(ctx)).toEqual({
      ok: false,
      code: 'no-provider',
      message: 'no account-balance provider is mounted',
    })
  })

  it('reads the account and carries every figure across as a decimal string', async () => {
    const fetchSpy = stubFetch(() => json(okBody))
    const ctx = await boot({ provider: true, key: 'sk-secret' })

    const result = await read(ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.available).toBe(true)
    expect(result.amounts).toEqual([
      { currency: 'CNY', total: '110.00', granted: '10.00', toppedUp: '100.00' },
    ])
    expect(result.fetchedAt).toBeGreaterThan(0)

    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(url).toBe('https://api.deepseek.com/user/balance')
    expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer sk-secret')
  })

  it('serves later callers from the shared cache without asking again', async () => {
    const fetchSpy = stubFetch(() => json(okBody))
    const ctx = await boot({ provider: true, key: 'sk-secret' })

    await read(ctx)
    await read(ctx)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    await read(ctx, true)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('drops the cached reading when a stored credential changes', async () => {
    const fetchSpy = stubFetch(() => json(okBody))
    const ctx = await boot({ provider: true, key: 'sk-first' })

    await read(ctx)
    await ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), 'sk-second')
    await read(ctx)

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const [, second] = fetchSpy.mock.calls
    expect((second?.[1]?.headers as Record<string, string>)['authorization']).toBe('Bearer sk-second')
  })

  it('returns not-configured as a value when no key is stored', async () => {
    stubFetch(() => json(okBody))
    const ctx = await boot({ provider: true })
    expect(await read(ctx)).toMatchObject({ ok: false, code: 'not-configured' })
  })

  it.each([
    [401, 'unauthorized'],
    [404, 'unsupported'],
    [503, 'provider-unavailable'],
  ])('maps a %i response to the %s failure class', async (status, code) => {
    stubFetch(() => json({ error: 'no' }, status))
    const ctx = await boot({ provider: true, key: 'sk-secret' })
    expect(await read(ctx)).toMatchObject({ ok: false, code })
  })

  it('stops serving a reading once the provider unmounts', async () => {
    stubFetch(() => json(okBody))
    const ctx = await boot({ key: 'sk-secret' })
    const fiber = await ctx.plugin(DeepSeekAccountBalance, PROVIDER)

    expect(await read(ctx)).toMatchObject({ ok: true })
    await fiber.dispose()
    expect(await read(ctx)).toMatchObject({ ok: false, code: 'no-provider' })
  })
})

describe('configuration', () => {
  it('loads a usage-info row restated before the cost estimate existed, at the patch defaults', async () => {
    // The shape a profile override carried before `showCost`, `costRates` and `costCurrency` were
    // added. The patch header tells operators to restate every key of the row, so this exact row is
    // sitting in real profiles; it must keep loading and pick the estimate up at cordis.patch.yml's
    // own defaults rather than fail with a missing required value.
    const preCost = { showContext: true, showBalance: false, refreshIntervalMs: 600_000, cacheTtlMs: 240_000 }
    const ctx = new Context()
    await ctx.plugin(UsageInfoService, preCost as UsageConfig)

    const view = await ctx.usageInfo.describe()
    expect(view).toMatchObject({
      showContext: true,
      showBalance: false,
      refreshIntervalMs: 600_000,
      showCost: true,
      costRates: { input: '0.28', cacheRead: '0.028', output: '0.42' },
      costCurrency: 'USD',
    })
  })

  it('defaults the cost keys to exactly what cordis.patch.yml ships', async () => {
    // The schema restates the patch's values for rows that predate them; this is what keeps the two
    // copies from drifting. Read as text because the patch is the one file a person edits by hand.
    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    const resolved = UsageInfoService.Config({
      showContext: true, showBalance: true, refreshIntervalMs: 300_000, cacheTtlMs: 240_000,
    } as UsageConfig)
    const { input, cacheRead, output } = resolved.costRates
    expect(patch).toContain(`showCost: ${String(resolved.showCost)}`)
    expect(patch).toContain(`costCurrency: ${resolved.costCurrency}`)
    expect(patch).toMatch(new RegExp(`input: '${input}'\\s+cacheRead: '${cacheRead}'\\s+output: '${output}'`, 'u'))
  })

  it('fills a partially restated rate table from the defaults rather than refusing it', () => {
    const resolved = UsageInfoService.Config({ ...USAGE, costRates: { output: '1.10' } } as unknown as UsageConfig)
    expect(resolved.costRates).toEqual({ input: '0.28', cacheRead: '0.028', output: '1.10' })
  })

  it('refuses a cache window wider than the poll cadence', async () => {
    await expect(boot({ usage: { cacheTtlMs: 400_000, refreshIntervalMs: 300_000 } }))
      .rejects.toThrowError(/cacheTtlMs/u)
  })

  it('refuses a warning threshold that is not an exact decimal', async () => {
    await expect(boot({ usage: { lowBalanceThreshold: '1e2' } }))
      .rejects.toThrowError(/exact decimal/u)
  })

  it('refuses a cost rate that is not a non-negative exact decimal', async () => {
    // A signed rate would let a session's cost fall as it spends, which is not a thing a bill does.
    await expect(boot({ usage: { costRates: { input: '-0.28', cacheRead: '0.028', output: '0.42' } } }))
      .rejects.toThrowError(/costRates\.input/u)
  })

  it('refuses a currency that is not an ISO 4217 code', async () => {
    await expect(boot({ usage: { costCurrency: 'usd' } })).rejects.toThrowError(/costCurrency/u)
  })
})
