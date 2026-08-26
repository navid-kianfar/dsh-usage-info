/**
 * The Host's balance cache: one reading shared by every browser that asks for it.
 *
 * Two properties matter, and neither is about speed. A balance endpoint is rate-limited and every
 * open tab polls on its own timer, so without a shared cache the provider sees a request rate that
 * scales with the number of windows a person left open. And a reading in flight must be shared
 * rather than duplicated, or the same poll tick from three tabs becomes three requests.
 * @module @deepseek-ai/dsh-usage-info/cache
 */

import type { AccountBalance } from '../balance/types.ts'

/** Ask the provider for one reading. */
export type BalanceLoader = (signal: AbortSignal) => Promise<AccountBalance>

/**
 * A cached balance reading with single-flight sharing.
 *
 * Freshness rides the reading's own `fetchedAt` rather than a second stamp taken here: the age a
 * surface displays and the age the TTL judges are then the same fact, and cannot drift apart.
 */
export class BalanceCache {
  private stored: AccountBalance | undefined
  private inFlight: Promise<AccountBalance> | undefined

  /**
   * @param load - the provider call this cache fronts.
   * @param now - clock, injected so freshness is testable without waiting.
   */
  constructor(private readonly load: BalanceLoader, private readonly now: () => number = Date.now) {}

  /**
   * Serve a reading, asking the provider only when one is actually needed.
   *
   * A caller that aborts stops waiting but does NOT cancel a shared reading: the other callers
   * waiting on it have not abandoned anything, and the provider's own deadline already bounds how
   * long it can run. Cancellation here means "I stopped caring about the answer", not "nobody may
   * have it".
   * @param ttlMs - how old a stored reading may be and still be served.
   * @param force - ask the provider even when a stored reading is still fresh.
   * @param signal - caller-owned cancellation.
   * @returns the reading.
   */
  async get(ttlMs: number, force: boolean, signal: AbortSignal): Promise<AccountBalance> {
    signal.throwIfAborted()
    if (!force && this.stored !== undefined && this.now() - this.stored.fetchedAt < ttlMs) {
      return this.stored
    }
    // A forced refresh joins a reading already in flight rather than starting a second one. The
    // in-flight reading is by definition newer than anything stored, which is all `force` asks for.
    this.inFlight ??= this.start()
    return await this.race(this.inFlight, signal)
  }

  /**
   * Drop the stored reading so the next `get` asks the provider.
   *
   * Called when the provider changes underneath the cache — a credential edit, a provider unmount —
   * where continuing to serve the old account's figures would be wrong rather than merely stale.
   */
  invalidate(): void {
    this.stored = undefined
  }

  /** Run one shared reading, storing it and clearing the in-flight slot either way. */
  private start(): Promise<AccountBalance> {
    // Never aborted: this promise belongs to every waiter, so no single caller's signal may end it.
    const shared = this.load(new AbortController().signal)
    const settle = shared.then(
      (reading) => {
        this.stored = reading
        this.inFlight = undefined
        return reading
      },
      (error: unknown) => {
        // A failed reading is not cached: the next caller must be free to try again immediately,
        // and a stored reading from before the failure stays valid until its own TTL expires.
        this.inFlight = undefined
        throw error
      },
    )
    // A caller who abandons the race leaves `settle` with no other handler attached in that tick.
    // Without this the process would see an unhandled rejection for a failure someone did observe.
    settle.catch(() => {})
    return settle
  }

  /**
   * Wait for a shared reading, or for this caller's own cancellation — whichever comes first.
   * @param shared - the in-flight reading.
   * @param signal - caller-owned cancellation.
   * @returns the reading, or rejects with the signal's reason.
   */
  private async race(shared: Promise<AccountBalance>, signal: AbortSignal): Promise<AccountBalance> {
    return await new Promise<AccountBalance>((resolve, reject) => {
      const onAbort = (): void => { reject(signal.reason as Error) }
      signal.addEventListener('abort', onAbort, { once: true })
      shared.then(resolve, reject).finally(() => { signal.removeEventListener('abort', onAbort) })
    })
  }
}
