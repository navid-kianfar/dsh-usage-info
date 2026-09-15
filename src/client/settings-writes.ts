/**
 * How the usage settings card writes, and how it learns whether a write held.
 *
 * Two facts about the bound settings scope shape everything here. First, `set` does not reject when
 * the Host refuses a value: the scope reloads the stored section and RESOLVES, so a card that only
 * awaited the promise would show a refused value as accepted until the next render put the old one
 * back. The outcome therefore has to be read from the snapshot once the writes settle. Second, a
 * field is written whole, so a card that builds a composite field (`costRates`) from the value it
 * rendered with loses the first of two edits made inside one round trip — both edits start from the
 * same render. The writer builds each value from the latest one it has sent instead.
 * @module @achasoft/dsh-usage-info/client/settings-writes
 */

/** Milliseconds in one second; the card edits seconds while the section stores milliseconds. */
export const MS_PER_SECOND = 1_000

/** The Host schema's own floor for `refreshIntervalMs` (`min(1_000)`), in seconds. */
const MIN_INTERVAL_SECONDS = 1

/** The part of a bound settings scope the writer drives; the harness's `SettingsScope` satisfies it. */
export interface WritableSettingsScope<T> {
  /** @returns the current sync snapshot; only its resolved value is read. */
  getSnapshot: () => { readonly value: T | undefined }
  /**
   * Queue one field write. Resolves after the write AND after any recovery read a refused write
   * triggers, so resolution says nothing about whether the value was kept.
   * @param field - the field name inside the namespace.
   * @param value - the JSON-shaped value.
   */
  set: (field: string, value: unknown) => Promise<void>
}

/**
 * What became of one write.
 *
 * `superseded` is its own answer rather than a kind of success: a later write to the same field from
 * this card replaced it before it could be judged, and the later one's outcome is the one to show.
 */
export type WriteOutcome = 'saved' | 'rejected' | 'superseded'

/** Field writes that report whether the Host kept them. */
export interface SettingsWriter<T> {
  /**
   * Write one field.
   * @param field - the field name.
   * @param value - its new value.
   * @returns what became of the write, once every write this writer has in flight has settled.
   */
  write: <K extends keyof T & string>(field: K, value: T[K]) => Promise<WriteOutcome>
  /**
   * Write one field computed from its latest value: the last one this writer sent while writes are
   * in flight, the settled one otherwise. This is what keeps two quick edits to one composite field
   * from overwriting each other.
   * @param field - the field name.
   * @param next - builds the new value from the latest one.
   * @returns what became of the write, as {@link SettingsWriter.write}.
   * @throws Error when the section has not loaded, since there is no value to build from.
   */
  update: <K extends keyof T & string>(field: K, next: (current: T[K]) => T[K]) => Promise<WriteOutcome>
}

/** One settled write waiting for the rest of its burst before it can be judged. */
interface Settled {
  readonly field: string
  readonly value: unknown
  readonly threw: boolean
  readonly resolve: (outcome: WriteOutcome) => void
}

/**
 * Compare two JSON-shaped values structurally, ignoring key order.
 *
 * The Host hands back a resolved section whose objects are not the ones this card sent, and whose key
 * order is the schema's rather than the card's, so identity and serialized text would both misreport
 * an accepted rate table as refused.
 * @param left - one value.
 * @param right - the other.
 * @returns whether they hold the same data.
 */
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  const leftEntries = Object.entries(left)
  const rightRecord = right as Record<string, unknown>
  if (leftEntries.length !== Object.keys(right).length) return false
  return leftEntries.every(([key, value]) => key in rightRecord && sameJson(value, rightRecord[key]))
}

/**
 * Wrap a settings scope so each write reports whether it held.
 *
 * Writes are judged in bursts: nothing is compared until every write this writer started has settled.
 * The scope publishes only its latest write's settlement, so judging an early write while a later one
 * is still in flight would read the snapshot from before either landed and report a kept value as
 * refused.
 * @param scope - the bound settings scope.
 * @returns the writer.
 */
export function settingsWriter<T extends object>(scope: WritableSettingsScope<T>): SettingsWriter<T> {
  // Mutable on purpose: both change as writes start and settle, and they are the burst.
  const sent = new Map<string, unknown>()
  const settled: Settled[] = []
  let inFlight = 0

  const judge = (entry: Settled, value: T | undefined): WriteOutcome => {
    if (sent.get(entry.field) !== entry.value) return 'superseded'
    if (entry.threw) return 'rejected'
    const stored = value === undefined ? undefined : (value as Record<string, unknown>)[entry.field]
    return sameJson(stored, entry.value) ? 'saved' : 'rejected'
  }

  const drain = (): void => {
    const { value } = scope.getSnapshot()
    for (const entry of settled) {
      const outcome = judge(entry, value)
      entry.resolve(outcome)
    }
    settled.length = 0
    // The burst is over, so the next write builds from what the Host actually kept — a refused value
    // must not become the base of the edit after it.
    sent.clear()
  }

  const send = async (field: string, value: unknown): Promise<WriteOutcome> => {
    sent.set(field, value)
    inFlight += 1
    let threw = false
    try {
      await scope.set(field, value)
    } catch {
      // Handled, not swallowed: a round trip that failed outright is reported to the person as a
      // refused write, and the scope has already reloaded the stored section it fell back to.
      threw = true
    } finally {
      inFlight -= 1
    }
    return await new Promise<WriteOutcome>((resolve) => {
      settled.push({ field, value, threw, resolve })
      if (inFlight === 0) drain()
    })
  }

  return {
    write: (field, value) => send(field, value),
    update: (field, next) => {
      const { value } = scope.getSnapshot()
      if (value === undefined) throw new Error(`settings: "${field}" cannot be updated before the section has loaded`)
      const latest = (sent.has(field) ? sent.get(field) : value[field]) as T[typeof field]
      const computed = next(latest)
      return send(field, computed)
    },
  }
}

/** A refresh-interval draft read against the constraints the Host enforces on every write. */
export type IntervalDraft =
  | { readonly kind: 'valid', readonly milliseconds: number }
  | { readonly kind: 'not-whole-seconds' }
  | { readonly kind: 'below-cache', readonly minimumSeconds: number }

/**
 * The shortest cadence the Host will accept for a given cache window, in whole seconds.
 *
 * The Host refuses `cacheTtlMs > refreshIntervalMs`, so the cache window IS the minimum. It is
 * rounded up because the card edits whole seconds, and rounding down would offer a value just below
 * the window that the Host then refuses.
 * @param cacheTtlMs - the resolved cache window.
 * @returns the minimum interval in seconds, never below the schema's own one-second floor.
 */
export function minimumIntervalSeconds(cacheTtlMs: number): number {
  const cacheSeconds = Math.ceil(cacheTtlMs / MS_PER_SECOND)
  return Math.max(MIN_INTERVAL_SECONDS, cacheSeconds)
}

/**
 * Read what a person typed into the interval field.
 * @param draft - the raw field text, in seconds.
 * @param cacheTtlMs - the resolved cache window the Host validates the interval against.
 * @returns the interval in milliseconds, or why the Host would refuse it.
 */
export function readIntervalDraft(draft: string, cacheTtlMs: number): IntervalDraft {
  const trimmed = draft.trim()
  const seconds = trimmed === '' ? Number.NaN : Number(trimmed)
  if (!Number.isSafeInteger(seconds) || seconds < MIN_INTERVAL_SECONDS) return { kind: 'not-whole-seconds' }
  const minimumSeconds = minimumIntervalSeconds(cacheTtlMs)
  if (seconds * MS_PER_SECOND < cacheTtlMs) return { kind: 'below-cache', minimumSeconds }
  return { kind: 'valid', milliseconds: seconds * MS_PER_SECOND }
}
