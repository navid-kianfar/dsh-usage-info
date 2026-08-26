/**
 * Usage-info plugin, browser half. Two registrations: the readout in the session header's utilities
 * seat, and the usage card on the plugin settings tab keyed by the `usage-info` namespace.
 *
 * The readout's two halves come from two different places, which is the whole design. Context
 * occupancy rides `useProjection` — the session projections the harness's token meter already
 * publishes reach every session-scoped seat as part of the standard kit, so the browser spends no
 * request and holds no second copy of numbers the Host has folded. The balance goes over this
 * plugin's own Remote namespace, because reading it needs an API key and a key in a browser is a
 * leaked key.
 * @module @deepseek-ai/dsh-client-ui-usage-info/client
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ctx.remote Context merge and the generated `usageInfo` namespace.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the session-header utilities seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the keyed settings.plugin.item slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// The generated Host-for-Client contract for this plugin's own endpoint. Importing it here — rather
// than adding a row to the curated api-remotes assembly — is what keeps the capability a plugin: the
// namespace mounts and unmounts with this fiber, and no shipped source names `usageInfo`.
import usageRemote from '../../generated/typert.remote-client.js'
import type { UsageBalanceResult, UsageInfoSettings, UsageInfoView } from '../host/types.ts'
import { UsageReadout } from './UsageReadout.tsx'
import { UsageSettingsCard } from './UsageSettingsCard.tsx'
import { en, zh, type UsageInfoKey } from './locales.ts'

export type { UsageInfoKey } from './locales.ts'
export type { UsageReadoutProps } from './UsageReadout.tsx'
export type { UsageSettingsCardProps } from './UsageSettingsCard.tsx'
export type { ContextOccupancy, ContextPart } from './context.ts'
export type { ReadingAge } from './money.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The session-header usage readout's and usage settings card's copy. */
    usageInfo: UsageInfoKey
  }
}

/** Dictionary namespace owned by this plugin. */
const LOCALE_NS = 'usageInfo'

/**
 * Settings namespace the Host section is registered under.
 *
 * Kebab-case, unlike {@link LOCALE_NS} and unlike the Remote namespace: settings namespaces are a
 * kebab-case grammar the Host validates, while a Remote namespace is read as a property and a
 * dictionary namespace is a plain key. Three spellings of one plugin's name is unfortunate but each
 * is fixed by the grammar it lives in.
 */
const SETTINGS_NS = 'usage-info'

/** Injected business face of the session-header readout. */
export interface UsageReadoutInjected {
  /**
   * Read what this readout is allowed to show and how often to poll: the balance provider's
   * readiness, the deployment's visibility flags, the refresh cadence, and the warning threshold.
   * @returns the usage-info view.
   */
  describeUsage: () => Promise<UsageInfoView>
  /**
   * Read the account balance.
   * @param refresh - ask the provider even when the Host holds a reading inside its cache window.
   * @returns the reading, or a classified failure carried as a value.
   */
  readBalance: (refresh: boolean) => Promise<UsageBalanceResult>
}

/** Injected business face of the usage settings card. */
export interface UsageSettingsInjected {
  /** Registrant-private reactive sources the renderer binds to `use<Name>` hooks. */
  hooks: {
    /** The bound `usage-info` settings scope: resolved value, layers, revision, and writability. */
    usageSettings: SettingsScope<UsageInfoSettings>
  }
  /**
   * Read the Host's current usage view for the card's status line.
   * @returns the usage-info view.
   */
  describeUsage: () => Promise<UsageInfoView>
  /**
   * Store one field of the `usage-info` section; the bound scope owns revision fencing.
   * @param field - the field name inside the namespace.
   * @param value - the JSON-shaped value the control produced.
   * @returns settlement after the write.
   */
  setField: (field: string, value: unknown) => Promise<void>
}

/**
 * Required services of the OUTER plugin: locale and the Remote mount point.
 *
 * Deliberately NOT `remote.usageInfo`. This plugin's apply creates that namespace by mounting its own
 * contribution, so it cannot also wait for it — and Cordis refuses to read a service the fiber did
 * not inject. Both halves of that bind are resolved by the child plugin below, which injects
 * `remote.usageInfo` after the parent has provided it.
 */
export const inject = ['locale', 'remote']

/**
 * Client plugin body: mount this plugin's own Remote namespace, then register the readout and the
 * settings card.
 * @param ctx - client root context.
 * @returns after the `usageInfo` namespace is callable; its methods are withdrawn when this fiber unloads.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  // Mounted on THIS fiber, so the endpoint's lifetime is the plugin's.
  await ctx.remote.$mount(usageRemote)
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'ui-usage-info: dictionaries')

  // The surface is a child so it can INJECT the namespace its parent just provided. Cordis will not
  // hand a fiber a service it did not declare, and the parent cannot declare one it creates itself;
  // the split is what lets the seats hold a properly injected reference.
  ctx.plugin({
    name: 'usage-info-surface',
    inject: ['slots', 'settingsScope', 'locale', 'remote', 'remote.usageInfo'],
    apply: surface,
  })
}

/**
 * Register the header readout and the settings card against a context that has the usage namespace.
 * @param ctx - the child fiber, with `remote.usageInfo` injected.
 */
function surface(ctx: ClientContext): void {
  // Both endpoints return the carrier's RemoteResult envelope. A transport failure is a different
  // fact from a balance failure, so it is thrown rather than folded into the business union the Host
  // defines: the readout keeps its previous reading on screen and the card keeps its status line.
  const unwrap = <T>(result: RemoteResult<T>): T => {
    if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
    return result.value
  }
  const describeUsage = (): Promise<UsageInfoView> => ctx.remote.usageInfo.describe().then(unwrap)
  const readBalance = (refresh: boolean): Promise<UsageBalanceResult> =>
    ctx.remote.usageInfo.balance({ refresh }).then(unwrap)

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    // List seats are addressed by id; the seat orders itself after the resident chrome.
    id: 'usage-info',
    locale: LOCALE_NS,
    inject: (): UsageReadoutInjected => ({ describeUsage, readBalance }),
  }, UsageReadout))

  const scope = ctx.settingsScope.bind<UsageInfoSettings>({ namespace: SETTINGS_NS })
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: SETTINGS_NS,
    locale: LOCALE_NS,
    inject: (): UsageSettingsInjected => ({
      hooks: { usageSettings: scope },
      describeUsage,
      setField: (field, value) => scope.set(field, value),
    }),
  }, UsageSettingsCard))
}
