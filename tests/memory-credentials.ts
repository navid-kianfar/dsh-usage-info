import type { Context } from '@deepseek-ai/cordis'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
// The seam splits its type surface: `/types` carries the client-safe brands and record union, while
// the provider-facing answer types live beside the abstract class they are returned from.
import type {
  CredentialInfo,
  CredentialRecordEntry,
  CredentialRecordInfo,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import type { CredentialKey, CredentialRecord, CredentialRef } from '@deepseek-ai/dsh-credentials/types'

/**
 * In-memory credentials provider for this package's seam tests: one always-writable `memory` source
 * seeded from plugin config. The record half is unimplemented territory rather than dead code — this
 * plugin addresses credentials by reference only, so a test that reached the record API would be
 * testing something the plugin does not do.
 */
export class MemoryCredentials extends CredentialProvider {
  private readonly store = new Map<string, string>()

  constructor(ctx: Context, seed: Record<string, string> = {}) {
    super(ctx)
    for (const [key, value] of Object.entries(seed)) this.store.set(key, value)
  }

  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.store.get(ref)
    return Promise.resolve(value === undefined || value.length === 0
      ? undefined
      : { value, source: 'memory' })
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    const value = this.store.get(ref)
    const configured = value !== undefined && value.length > 0
    return Promise.resolve({ configured, ...configured ? { source: 'memory' } : {}, writable: true })
  }

  override set(ref: CredentialRef, value: string): Promise<void> {
    this.store.set(ref, value)
    this.ctx.emit('credentials/reference-updated', ref)
    return Promise.resolve()
  }

  override unset(ref: CredentialRef): Promise<void> {
    if (this.store.delete(ref)) this.ctx.emit('credentials/reference-updated', ref)
    return Promise.resolve()
  }

  override readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.reject(new Error('memory credentials: records are out of scope for these tests'))
  }

  override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.reject(new Error('memory credentials: records are out of scope for these tests'))
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([])
  }

  override modifyRecord(
    _key: CredentialKey,
    _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    return Promise.reject(new Error('memory credentials: records are out of scope for these tests'))
  }

  override deleteRecord(_key: CredentialKey): Promise<void> {
    return Promise.reject(new Error('memory credentials: records are out of scope for these tests'))
  }
}
