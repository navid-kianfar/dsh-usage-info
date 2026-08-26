import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: the keyed settings.plugin.item slot declaration. Cross-plugin collaboration goes
// through cordis services; a value import fails the client bundle-purity gate, so this card
// reproduces the section's card and field chrome rather than importing its components.
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

/** One labelled row: a control on the right of its label, with a hint beneath. */
function Field(props: {
  id: string
  label: string
  hint: ReactNode
  /** Rendered to the right of the label, where the section's own fields put their badges. */
  control: ReactNode
  /** Whether the hint reports a rejected draft rather than describing the field. */
  invalid?: boolean
}) {
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        {props.control}
      </div>
      <p className={props.invalid === true ? css.invalid : css.hint}>{props.hint}</p>
    </div>
  )
}

/**
 * The usage-info card on the plugin-configuration tab: which provider answers for the balance, and
 * the four preferences a person changes.
 *
 * The card reproduces the configuration section's own chrome — an `<li>` disclosure card, and fields
 * laid out label / control / hint — because it cannot import those components. The section stacks
 * cards in a `<ul>` and value-importing across a plugin boundary fails the client bundle-purity
 * gate, so matching is done by rebuilding against the same design tokens.
 *
 * Unlike the section's built-in cards there is no save or discard: every control writes immediately
 * through the bound settings scope, which owns revision fencing, so the card carries no staged form
 * whose unsaved state would need reporting.
 */
export function UsageSettingsCard(props: UsageSettingsCardProps) {
  const { t, setField, describeUsage } = props
  const settings = props.useUsageSettings(snapshot => snapshot)
  const [capability, setCapability] = useState<UsageInfoView | null>(null)
  const [open, setOpen] = useState(false)
  const [thresholdDraft, setThresholdDraft] = useState<string | null>(null)
  const fieldId = useId()
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

  // The threshold is the one field whose draft can be a value the Host would reject, so it is held
  // locally while typing. Every other control produces only values the schema accepts, and writes
  // straight through.
  const threshold = thresholdDraft ?? value?.lowBalanceThreshold ?? ''
  const thresholdInvalid = threshold !== '' && !DECIMAL.test(threshold)

  const ready = capability?.balanceAvailable === true && capability.ready
  const providerHint = capability === null || !capability.balanceAvailable
    ? t('settings.provider.none')
    : `${capability.provider ?? ''}${capability.endpoint === undefined ? '' : ` · ${capability.endpoint}`}`

  return (
    <li className={open ? `${css.card} ${css.cardOpen}` : css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{t('settings.title')}</span>
          <span className={css.description}>{t('settings.description')}</span>
        </span>
        <IconChevronDownOutline14
          className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron}
        />
      </button>

      {open && (
        <div className={css.body}>
          <Field
            id={`${fieldId}-provider`}
            label={t('settings.provider')}
            control={(
              <span className={css.badges}>
                <span className={ready ? css.badge : css.badgeMuted}>
                  {ready ? t('settings.status.ready') : t('settings.status.notReady')}
                </span>
              </span>
            )}
            /* The readiness detail is an operator diagnostic and stays English by policy; it replaces
               the identity line only when there is something wrong to say. */
            hint={capability?.detail ?? providerHint}
          />

          <Field
            id={`${fieldId}-context`}
            label={t('settings.showContext')}
            control={(
              <input
                id={`${fieldId}-context`}
                className={css.switch}
                type="checkbox"
                role="switch"
                disabled={disabled}
                checked={value?.showContext ?? true}
                onChange={(event) => { void setField('showContext', event.target.checked) }}
              />
            )}
            hint={t('settings.showContext.hint')}
          />

          <Field
            id={`${fieldId}-balance`}
            label={t('settings.showBalance')}
            control={(
              <input
                id={`${fieldId}-balance`}
                className={css.switch}
                type="checkbox"
                role="switch"
                disabled={disabled}
                checked={value?.showBalance ?? true}
                onChange={(event) => { void setField('showBalance', event.target.checked) }}
              />
            )}
            hint={t('settings.showBalance.hint')}
          />

          <Field
            id={`${fieldId}-interval`}
            label={t('settings.refreshInterval')}
            control={(
              // Seconds here, milliseconds on the wire: a person setting a poll cadence thinks in
              // seconds, while the section's unit is fixed by the schema it shares with cordis.yml.
              <input
                id={`${fieldId}-interval`}
                className={css.input}
                type="number"
                min={1}
                inputMode="numeric"
                disabled={disabled}
                value={value === undefined ? '' : Math.round(value.refreshIntervalMs / 1_000)}
                onChange={(event) => {
                  const seconds = Number(event.target.value)
                  // A non-integer or sub-second entry is refused here rather than sent: the Host
                  // schema would reject it, and a rejected write leaves the field looking accepted.
                  if (Number.isSafeInteger(seconds) && seconds >= 1) {
                    void setField('refreshIntervalMs', seconds * 1_000)
                  }
                }}
              />
            )}
            hint={t('settings.refreshInterval.hint')}
          />

          <Field
            id={`${fieldId}-threshold`}
            label={t('settings.lowBalanceThreshold')}
            control={(
              <input
                id={`${fieldId}-threshold`}
                className={thresholdInvalid ? css.inputInvalid : css.input}
                type="text"
                inputMode="decimal"
                placeholder="10.00"
                disabled={disabled}
                {...thresholdInvalid ? { 'aria-invalid': true } : {}}
                value={threshold}
                onChange={(event) => {
                  const next = event.target.value
                  setThresholdDraft(next)
                  // Blank clears the warning; anything else must be an exact decimal, because the
                  // Host compares it digit-wise against the balance and rejects what it cannot.
                  if (next === '' || DECIMAL.test(next)) void setField('lowBalanceThreshold', next)
                }}
              />
            )}
            invalid={thresholdInvalid}
            hint={thresholdInvalid
              ? t('settings.lowBalanceThreshold.invalid')
              : t('settings.lowBalanceThreshold.hint')}
          />
        </div>
      )}
    </li>
  )
}
