import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the keyed settings.plugin.item slot declaration. Cross-plugin collaboration goes
// through cordis services; a value import fails the client bundle-purity gate, so this card renders
// its own chrome rather than reusing the section's fields.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { UsageInfoView } from '../host/types.ts'
import type { UsageSettingsInjected } from './index.ts'
import css from './UsageSettingsCard.module.css'

/** An exact decimal quantity: optional sign, digits, optional fraction. */
const DECIMAL = /^-?\d+(?:\.\d+)?$/u

/** Props the renderer binds for the usage settings card. */
export type UsageSettingsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'usageInfo'>
  & InjectFace<UsageSettingsInjected>

/**
 * The usage card on the plugin-configuration tab: which provider answers for the balance, and the
 * four preferences a person changes. Every control writes immediately through the bound settings
 * scope, which owns revision fencing, so the card carries no staged form of its own.
 */
export function UsageSettingsCard(props: UsageSettingsCardProps) {
  const { t, setField, describeUsage } = props
  const settings = props.useUsageSettings(snapshot => snapshot)
  const [capability, setCapability] = useState<UsageInfoView | null>(null)
  const value = settings.value
  const disabled = !settings.writable || value === undefined

  useEffect(() => {
    let alive = true
    void describeUsage().then((next) => {
      if (alive) setCapability(next)
    }, () => {
      // A failed probe leaves the status line on its "no provider" copy, which is the same thing a
      // deployment without a provider shows; the controls below stay editable either way.
    })
    return () => { alive = false }
  }, [describeUsage])

  return (
    <section className={css.card}>
      <header className={css.head}>
        <span className={css.title}>{t('settings.title')}</span>
        <span className={css.description}>{t('settings.description')}</span>
      </header>

      <div className={css.row}>
        <span className={css.label}>{t('settings.provider')}</span>
        <span className={css.status}>
          {capability === null || !capability.balanceAvailable
            ? t('settings.provider.none')
            : (
              <>
                {capability.provider}
                {' '}
                <span className={`${css.badge} ${capability.ready ? css.ready : css.notReady}`}>
                  {capability.ready ? t('settings.status.ready') : t('settings.status.notReady')}
                </span>
              </>
            )}
        </span>
      </div>
      {/* Readiness detail and the endpoint are operator diagnostics; error surfaces stay English. */}
      {capability?.endpoint !== undefined && <span className={css.status}>{capability.endpoint}</span>}
      {capability?.detail !== undefined && <span className={css.status}>{capability.detail}</span>}

      <label className={css.row}>
        <span className={css.label}>{t('settings.showContext')}</span>
        <input
          className={css.toggle}
          type="checkbox"
          disabled={disabled}
          checked={value?.showContext ?? true}
          onChange={(event) => { void setField('showContext', event.target.checked) }}
        />
      </label>

      <label className={css.row}>
        <span className={css.label}>{t('settings.showBalance')}</span>
        <input
          className={css.toggle}
          type="checkbox"
          disabled={disabled}
          checked={value?.showBalance ?? true}
          onChange={(event) => { void setField('showBalance', event.target.checked) }}
        />
      </label>

      <label className={css.row}>
        <span className={css.label}>{t('settings.refreshInterval')}</span>
        {/* Seconds here, milliseconds on the wire: a person setting a poll cadence thinks in seconds,
            and the section's unit is fixed by the Host schema it shares with the composition file. */}
        <input
          className={css.control}
          type="number"
          min={1}
          disabled={disabled}
          value={value === undefined ? 0 : Math.round(value.refreshIntervalMs / 1_000)}
          onChange={(event) => {
            const seconds = Number(event.target.value)
            // A non-integer or sub-second entry is refused here rather than sent: the Host schema
            // would reject it, and a rejected write leaves the field looking accepted.
            if (Number.isSafeInteger(seconds) && seconds >= 1) {
              void setField('refreshIntervalMs', seconds * 1_000)
            }
          }}
        />
      </label>

      <label className={css.row}>
        <span className={css.label}>{t('settings.lowBalanceThreshold')}</span>
        <input
          className={css.control}
          type="text"
          inputMode="decimal"
          disabled={disabled}
          value={value?.lowBalanceThreshold ?? ''}
          onChange={(event) => {
            const next = event.target.value
            // Blank clears the warning; anything else must be an exact decimal, because the Host
            // compares it digit-wise against the balance and rejects a value it cannot.
            if (next === '' || DECIMAL.test(next)) void setField('lowBalanceThreshold', next)
          }}
        />
      </label>
    </section>
  )
}
