import { describe, expect, it, vi } from 'vitest'
import { BalanceCache } from '../src/host/cache.ts'
import type { AccountBalance } from '../src/balance/types.ts'

/** One reading stamped at a chosen instant. */
const reading = (fetchedAt: number, total = '100.00'): AccountBalance => ({
  available: true,
  amounts: [{ currency: 'CNY', total }],
  fetchedAt,
})

/** A clock the test moves by hand. */
function clock(start: number) {
  let now = start
  return { now: () => now, advance: (ms: number) => { now += ms } }
}

describe('BalanceCache', () => {
  it('asks the provider once and serves the stored reading inside the window', async () => {
    const time = clock(1_000)
    const load = vi.fn(() => Promise.resolve(reading(time.now())))
    const cache = new BalanceCache(load, time.now)

    await cache.get(60_000, false, new AbortController().signal)
    time.advance(30_000)
    const second = await cache.get(60_000, false, new AbortController().signal)

    expect(load).toHaveBeenCalledTimes(1)
    expect(second.fetchedAt).toBe(1_000)
  })

  it('asks again once the stored reading falls out of the window', async () => {
    const time = clock(1_000)
    const load = vi.fn(() => Promise.resolve(reading(time.now())))
    const cache = new BalanceCache(load, time.now)

    await cache.get(60_000, false, new AbortController().signal)
    time.advance(60_000)
    const second = await cache.get(60_000, false, new AbortController().signal)

    expect(load).toHaveBeenCalledTimes(2)
    expect(second.fetchedAt).toBe(61_000)
  })

  it('asks again when the caller forces a refresh inside the window', async () => {
    const time = clock(1_000)
    const load = vi.fn(() => Promise.resolve(reading(time.now())))
    const cache = new BalanceCache(load, time.now)

    await cache.get(60_000, false, new AbortController().signal)
    await cache.get(60_000, true, new AbortController().signal)

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares one reading among callers that arrive while it is in flight', async () => {
    let release: (value: AccountBalance) => void = () => {}
    const load = vi.fn(() => new Promise<AccountBalance>((resolve) => { release = resolve }))
    const cache = new BalanceCache(load, () => 0)

    const first = cache.get(60_000, false, new AbortController().signal)
    const second = cache.get(60_000, false, new AbortController().signal)
    // A forced refresh joins too: the in-flight reading is already newer than anything stored.
    const third = cache.get(60_000, true, new AbortController().signal)
    release(reading(0))

    expect(await Promise.all([first, second, third])).toEqual([reading(0), reading(0), reading(0)])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('lets one caller abandon a reading without ending it for the others', async () => {
    let release: (value: AccountBalance) => void = () => {}
    const load = vi.fn(() => new Promise<AccountBalance>((resolve) => { release = resolve }))
    const cache = new BalanceCache(load, () => 0)

    const abandoning = new AbortController()
    const abandoned = cache.get(60_000, false, abandoning.signal)
    const waiting = cache.get(60_000, false, new AbortController().signal)
    abandoning.abort(new Error('gone'))
    release(reading(0))

    await expect(abandoned).rejects.toThrowError('gone')
    await expect(waiting).resolves.toEqual(reading(0))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('refuses a caller whose signal is already aborted without asking the provider', async () => {
    const load = vi.fn(() => Promise.resolve(reading(0)))
    const cache = new BalanceCache(load, () => 0)

    await expect(cache.get(60_000, false, AbortSignal.abort(new Error('stale')))).rejects.toThrowError('stale')
    expect(load).not.toHaveBeenCalled()
  })

  it('does not cache a failure, so the next caller may try again at once', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(reading(0))
    const cache = new BalanceCache(load as () => Promise<AccountBalance>, () => 0)

    await expect(cache.get(60_000, false, new AbortController().signal)).rejects.toThrowError('down')
    await expect(cache.get(60_000, false, new AbortController().signal)).resolves.toEqual(reading(0))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('drops the stored reading when invalidated, so the next caller asks the provider again', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce(reading(0, '100.00'))
      .mockResolvedValueOnce(reading(0, '5.00'))
    const cache = new BalanceCache(load as () => Promise<AccountBalance>, () => 0)

    await cache.get(60_000, false, new AbortController().signal)
    cache.invalidate()
    const second = await cache.get(60_000, false, new AbortController().signal)

    expect(second.amounts[0]?.total).toBe('5.00')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('discards a reading that was in flight when the key changed, however late it lands', async () => {
    // The old key's reading is started first and settles LAST: the order a slow provider produces
    // when someone swaps accounts while a poll is still waiting on the previous one.
    const releases: ((value: AccountBalance) => void)[] = []
    const load = vi.fn(() => new Promise<AccountBalance>((resolve) => { releases.push(resolve) }))
    const cache = new BalanceCache(load, () => 0)

    const beforeChange = cache.get(60_000, false, new AbortController().signal)
    cache.invalidate()
    const afterChange = cache.get(60_000, false, new AbortController().signal)
    expect(load).toHaveBeenCalledTimes(2)

    releases[1]?.(reading(0, '5.00'))
    releases[0]?.(reading(0, '100.00'))

    // The caller who asked before the change waited on the old key, and is re-served the new one
    // rather than handed the previous account's money.
    await expect(afterChange).resolves.toEqual(reading(0, '5.00'))
    await expect(beforeChange).resolves.toEqual(reading(0, '5.00'))
    // And the late reading was not stored: a caller inside the window still sees the new account.
    await expect(cache.get(60_000, false, new AbortController().signal)).resolves.toEqual(reading(0, '5.00'))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not let a stale in-flight failure clear the slot of the reading that replaced it', async () => {
    const settlers: { resolve: (value: AccountBalance) => void, reject: (error: Error) => void }[] = []
    const load = vi.fn(() => new Promise<AccountBalance>((resolve, reject) => { settlers.push({ resolve, reject }) }))
    const cache = new BalanceCache(load, () => 0)

    const stale = cache.get(60_000, false, new AbortController().signal)
    cache.invalidate()
    const fresh = cache.get(60_000, false, new AbortController().signal)
    settlers[0]?.reject(new Error('old key refused'))
    // A third caller arriving now must join the new key's reading, not start another one.
    const joining = cache.get(60_000, false, new AbortController().signal)
    settlers[1]?.resolve(reading(0, '5.00'))

    await expect(fresh).resolves.toEqual(reading(0, '5.00'))
    await expect(joining).resolves.toEqual(reading(0, '5.00'))
    await expect(stale).resolves.toEqual(reading(0, '5.00'))
    expect(load).toHaveBeenCalledTimes(2)
  })
})
