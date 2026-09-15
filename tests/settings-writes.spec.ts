import { describe, expect, it } from 'vitest'
import {
  minimumIntervalSeconds,
  readIntervalDraft,
  settingsWriter,
  type WritableSettingsScope,
} from '../src/client/settings-writes.ts'
import type { UsageInfoSettings } from '../src/host/types.ts'

/** The composition defaults, mirroring cordis.patch.yml. */
const DEFAULTS: UsageInfoSettings = {
  showContext: true,
  showCost: true,
  showBalance: true,
  costRates: { input: '0.28', cacheRead: '0.028', output: '0.42' },
  costCurrency: 'USD',
  refreshIntervalMs: 300_000,
  cacheTtlMs: 240_000,
}

/**
 * A settings scope that behaves like the installed harness's (0.1.5-rc.2) on the three points these
 * tests depend on: writes run one at a time against the Host's CURRENT section, the Host re-validates
 * the whole section and refuses what `validateConfig` refuses, and `set` never rejects for a refused
 * write — it reloads the stored section and resolves, which is exactly why a caller cannot learn the
 * outcome from the promise alone. Each round trip is held open until the test releases it.
 */
function hostScope(initial: UsageInfoSettings) {
  let stored = initial
  let snapshot: { value: UsageInfoSettings | undefined } = { value: initial }
  let tail: Promise<void> = Promise.resolve()
  let queued = 0
  const gates: (() => void)[] = []
  const scope: WritableSettingsScope<UsageInfoSettings> = {
    getSnapshot: () => snapshot,
    set(field, value) {
      queued += 1
      const task = tail.then(async () => {
        await new Promise<void>((resolve) => { gates.push(resolve) })
        queued -= 1
        const next = { ...stored, [field]: value } as UsageInfoSettings
        if (next.cacheTtlMs > next.refreshIntervalMs) {
          snapshot = { value: stored }
          return
        }
        stored = next
        snapshot = { value: stored }
      })
      tail = task.catch(() => {})
      return task
    },
  }
  /** A macrotask turn, so every promise continuation queued so far has run. */
  const turn = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })
  /** Let every write queued so far complete its round trip, in order. */
  const flush = async (): Promise<void> => {
    while (queued > 0) {
      await turn()
      for (const open of gates.splice(0)) open()
    }
    await turn()
  }
  return { scope, flush, stored: () => stored }
}

describe('settingsWriter', () => {
  it('reports a write the Host accepted as saved', async () => {
    const host = hostScope(DEFAULTS)
    const writer = settingsWriter(host.scope)

    const outcome = writer.write('refreshIntervalMs', 600_000)
    await host.flush()

    await expect(outcome).resolves.toBe('saved')
    expect(host.stored().refreshIntervalMs).toBe(600_000)
  })

  it('reports a write the Host refused as rejected, though the scope resolved it', async () => {
    const host = hostScope(DEFAULTS)
    const writer = settingsWriter(host.scope)

    // Below cacheTtlMs: the Host refuses it and the scope quietly reloads the stored 300 s.
    const outcome = writer.write('refreshIntervalMs', 60_000)
    await host.flush()

    await expect(outcome).resolves.toBe('rejected')
    expect(host.stored().refreshIntervalMs).toBe(300_000)
  })

  it('reports an earlier write to the same field as superseded rather than judging it', async () => {
    const host = hostScope(DEFAULTS)
    const writer = settingsWriter(host.scope)

    const first = writer.write('costCurrency', 'EUR')
    const second = writer.write('costCurrency', 'CNY')
    await host.flush()

    await expect(first).resolves.toBe('superseded')
    await expect(second).resolves.toBe('saved')
  })

  it('reports a write whose round trip threw as rejected', async () => {
    const writer = settingsWriter<UsageInfoSettings>({
      getSnapshot: () => ({ value: DEFAULTS }),
      set: () => Promise.reject(new Error('connection lost')),
    })
    await expect(writer.write('showCost', false)).resolves.toBe('rejected')
  })

  it('keeps two rate edits made inside one round trip, where render-time values would lose one', async () => {
    // The control: the card's previous write, a whole `costRates` object built from the values it
    // rendered with. Both edits start from the same render, so the second restores the first's old
    // rate. If this ever stops losing an edit, the fake no longer reproduces the race below.
    const racy = hostScope(DEFAULTS)
    const rendered = racy.scope.getSnapshot().value?.costRates ?? DEFAULTS.costRates
    void racy.scope.set('costRates', { ...rendered, input: '0.5' })
    void racy.scope.set('costRates', { ...rendered, output: '0.9' })
    await racy.flush()
    expect(racy.stored().costRates).toEqual({ input: '0.28', cacheRead: '0.028', output: '0.9' })

    const host = hostScope(DEFAULTS)
    const writer = settingsWriter(host.scope)
    const first = writer.update('costRates', rates => ({ ...rates, input: '0.5' }))
    const second = writer.update('costRates', rates => ({ ...rates, output: '0.9' }))
    await host.flush()

    expect(host.stored().costRates).toEqual({ input: '0.5', cacheRead: '0.028', output: '0.9' })
    await expect(first).resolves.toBe('superseded')
    await expect(second).resolves.toBe('saved')
  })

  it('builds from the settled value again once a burst is over', async () => {
    const host = hostScope(DEFAULTS)
    const writer = settingsWriter(host.scope)

    const refused = writer.update('refreshIntervalMs', () => 1_000)
    await host.flush()
    await expect(refused).resolves.toBe('rejected')

    // The refused 1 s must not be the base of the next edit: it never became the stored value.
    const next = writer.update('refreshIntervalMs', current => current * 2)
    await host.flush()
    await expect(next).resolves.toBe('saved')
    expect(host.stored().refreshIntervalMs).toBe(600_000)
  })

  it('refuses a functional update before the section has loaded', () => {
    const writer = settingsWriter<UsageInfoSettings>({
      getSnapshot: () => ({ value: undefined }),
      set: () => Promise.resolve(),
    })
    expect(() => writer.update('costRates', rates => rates)).toThrowError(/before the section has loaded/u)
  })
})

describe('readIntervalDraft', () => {
  it('accepts whole seconds at or above the cache window', () => {
    expect(readIntervalDraft('240', 240_000)).toEqual({ kind: 'valid', milliseconds: 240_000 })
    expect(readIntervalDraft(' 600 ', 240_000)).toEqual({ kind: 'valid', milliseconds: 600_000 })
  })

  it('refuses a cadence below the cache window, naming the minimum', () => {
    // The keystroke sequence that used to write 6 s and then 60 s, both refused by the Host.
    expect(readIntervalDraft('6', 240_000)).toEqual({ kind: 'below-cache', minimumSeconds: 240 })
    expect(readIntervalDraft('60', 240_000)).toEqual({ kind: 'below-cache', minimumSeconds: 240 })
  })

  it('refuses what is not a whole number of seconds', () => {
    expect(readIntervalDraft('', 0)).toEqual({ kind: 'not-whole-seconds' })
    expect(readIntervalDraft('1.5', 0)).toEqual({ kind: 'not-whole-seconds' })
    expect(readIntervalDraft('0', 0)).toEqual({ kind: 'not-whole-seconds' })
    expect(readIntervalDraft('abc', 0)).toEqual({ kind: 'not-whole-seconds' })
  })
})

describe('minimumIntervalSeconds', () => {
  it('rounds a cache window up to whole seconds, and never goes below one', () => {
    expect(minimumIntervalSeconds(240_000)).toBe(240)
    expect(minimumIntervalSeconds(240_500)).toBe(241)
    expect(minimumIntervalSeconds(0)).toBe(1)
  })
})
