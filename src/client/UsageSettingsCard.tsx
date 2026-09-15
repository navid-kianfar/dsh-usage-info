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
import {
  MS_PER_SECOND,
  minimumIntervalSeconds,
  readIntervalDraft,
  type IntervalDraft,
  type WriteOutcome,
} from './settings-writes.ts'
import css from './UsageSettingsCard.module.css'

/** An exact decimal quantity: optional sign, digits, optional fraction. */
const DECIMAL = /^-?\d+(?:\.\d+)?$/u

/** A rate: an exact decimal that cannot be negative, matching what the Host's schema accepts. */
const RATE = /^\d+(?:\.\d+)?$/u

/** An ISO 4217 code, as the Host's schema spells it. */
const CURRENCY = /^[A-Z]{3}$/u

/** The three rates, each with the dictionary key naming it. */
const RATE_FIELDS = [
  { key: 'input', label: 'settings.priceInput' },
  { key: 'cacheRead', label: 'settings.priceCacheRead' },
  { key: 'output', label: 'settings.priceOutput' },
] as const

/** One rate's name inside the `costRates` section. */
type RateKey = typeof RATE_FIELDS[number]['key']

/** The three on/off preferences, each written straight through from its switch. */
type FlagField = 'showContext' | 'showCost' | 'showBalance'

/**
 * Every control that writes, so a refused write can be reported on the field that made it. The rates
 * share one settings field but are three controls, and a refusal belongs to the one that was edited.
 */
type ControlKey = FlagField | 'refreshIntervalMs' | 'lowBalanceThreshold' | 'costCurrency' | `costRates.${RateKey}`

/** Why an interval draft was not written; the valid case is a write, not a refusal. */
type IntervalRefusal = Exclude<IntervalDraft, { kind: 'valid' }>

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
 * the preferences a person changes — what the readout shows, how often it re-reads the balance, when
 * it warns, and the rates it estimates a session's cost at.
 *
 * The card reproduces the configuration section's own chrome — an `<li>` disclosure card, and fields
 * laid out label / control / hint — because it cannot import those components. The section stacks
 * cards in a `<ul>` and value-importing across a plugin boundary fails the client bundle-purity
 * gate, so matching is done by rebuilding against the same design tokens.
 *
 * Unlike the section's built-in cards there is no save or discard: every control writes through the
 * bound settings scope, which owns revision fencing, as soon as it holds a value the Host would
 * accept — the switches and text fields on change, the refresh interval on blur or Enter. A write the
 * Host refuses anyway is reported on its field: the scope resolves a refused write rather than
 * rejecting it, so the card asks the writer what became of each one instead of trusting the promise.
 */
export function UsageSettingsCard(props: UsageSettingsCardProps) {
  const { t, writeSettings, describeUsage } = props
  const settings = props.useUsageSettings(snapshot => snapshot)
  const [capability, setCapability] = useState<UsageInfoView | null>(null)
  const [open, setOpen] = useState(false)
  const [thresholdDraft, setThresholdDraft] = useState<string | null>(null)
  const [currencyDraft, setCurrencyDraft] = useState<string | null>(null)
  const [rateDraft, setRateDraft] = useState<Partial<Record<RateKey, string>>>({})
  const [intervalDraft, setIntervalDraft] = useState<string | null>(null)
  const [intervalRefusal, setIntervalRefusal] = useState<IntervalRefusal | null>(null)
  const [refused, setRefused] = useState<Partial<Record<ControlKey, true>>>({})
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

  /**
   * Report what became of one write on the control that made it.
   * @param control - the control the write came from.
   * @param write - the writer's outcome for it.
   * @param onSaved - clears that control's draft once the Host kept the value, so the field shows the
   * stored section again and a later change from elsewhere is not hidden behind a stale draft.
   */
  const track = (control: ControlKey, write: Promise<WriteOutcome>, onSaved: () => void): void => {
    // The writer resolves every outcome and never rejects, so this `then` observes the whole result.
    void write.then((outcome) => {
      switch (outcome) {
        case 'superseded':
          // A later edit to the same field owns the verdict; judging this one would flash its state.
          return
        case 'saved':
          setRefused(({ [control]: _cleared, ...kept }) => kept)
          onSaved()
          return
        case 'rejected':
          setRefused(current => ({ ...current, [control]: true }))
          return
        default: {
          const unexpected: never = outcome
          throw new Error(`usage-info: unhandled write outcome "${String(unexpected)}"`)
        }
      }
    })
  }

  /**
   * Write one on/off preference; a switch can only produce a value the schema accepts.
   * @param field - the preference.
   * @param checked - the switch's new state.
   */
  const writeFlag = (field: FlagField, checked: boolean): void => {
    const write = writeSettings.write(field, checked)
    track(field, write, () => {})
  }

  // The threshold is the one field whose draft can be a value the Host would reject, so it is held
  // locally while typing and written only once it is a value the Host accepts.
  const threshold = thresholdDraft ?? value?.lowBalanceThreshold ?? ''
  const thresholdInvalid = threshold !== '' && !DECIMAL.test(threshold)

  // The cost fields hold drafts for the same reason the threshold does: a half-typed rate or currency
  // is not a value the Host's schema would accept. A rate is written through a functional update over
  // the whole `costRates` field, because that is the shape the section is declared in and building it
  // from the rendered value would let two quick edits overwrite each other.
  const currency = currencyDraft ?? value?.costCurrency ?? ''
  const currencyInvalid = currency !== '' && !CURRENCY.test(currency)
  const writeRate = (key: RateKey, next: string): void => {
    if (value === undefined) return
    const write = writeSettings.update('costRates', rates => ({ ...rates, [key]: next }))
    track(`costRates.${key}`, write, () => {
      setRateDraft((current) => {
        if (current[key] !== next) return current
        const { [key]: _committed, ...kept } = current
        return kept
      })
    })
  }

  // The interval is held as a draft and committed on blur or Enter, never per keystroke: on the way to
  // "600" a person types "6" and "60", and each of those is a cadence the Host refuses because it is
  // shorter than the cache window. It is judged here against that same window before anything is sent.
  const storedSeconds = value === undefined ? '' : `${Math.round(value.refreshIntervalMs / MS_PER_SECOND)}`
  const interval = intervalDraft ?? storedSeconds
  const minimumSeconds = value === undefined ? undefined : minimumIntervalSeconds(value.cacheTtlMs)
  const commitInterval = (): void => {
    if (value === undefined || intervalDraft === null) return
    const reading = readIntervalDraft(intervalDraft, value.cacheTtlMs)
    if (reading.kind !== 'valid') {
      setIntervalRefusal(reading)
      return
    }
    if (reading.milliseconds === value.refreshIntervalMs) {
      setIntervalDraft(null)
      return
    }
    const committed = intervalDraft
    const write = writeSettings.write('refreshIntervalMs', reading.milliseconds)
    track('refreshIntervalMs', write, () => {
      setIntervalDraft(current => (current === committed ? null : current))
    })
  }
  const intervalInvalid = intervalRefusal !== null || refused.refreshIntervalMs === true
  /** @returns the interval's hint: why a draft was refused, or the field's description with its minimum. */
  const intervalHint = (): string => {
    if (intervalRefusal?.kind === 'below-cache') {
      return t('settings.refreshInterval.belowCache', { seconds: `${intervalRefusal.minimumSeconds}` })
    }
    if (intervalRefusal?.kind === 'not-whole-seconds') return t('settings.refreshInterval.invalid')
    if (refused.refreshIntervalMs === true) return t('settings.saveFailed')
    const description = t('settings.refreshInterval.hint')
    if (minimumSeconds === undefined) return description
    const minimum = t('settings.refreshInterval.minimum', { seconds: `${minimumSeconds}` })
    return `${description} ${minimum}`
  }

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
                onChange={(event) => { writeFlag('showContext', event.target.checked) }}
              />
            )}
            invalid={refused.showContext === true}
            hint={refused.showContext === true ? t('settings.saveFailed') : t('settings.showContext.hint')}
          />

          <Field
            id={`${fieldId}-cost`}
            label={t('settings.showCost')}
            control={(
              <input
                id={`${fieldId}-cost`}
                className={css.switch}
                type="checkbox"
                role="switch"
                disabled={disabled}
                checked={value?.showCost ?? true}
                onChange={(event) => { writeFlag('showCost', event.target.checked) }}
              />
            )}
            invalid={refused.showCost === true}
            hint={refused.showCost === true ? t('settings.saveFailed') : t('settings.showCost.hint')}
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
                onChange={(event) => { writeFlag('showBalance', event.target.checked) }}
              />
            )}
            invalid={refused.showBalance === true}
            hint={refused.showBalance === true ? t('settings.saveFailed') : t('settings.showBalance.hint')}
          />

          <Field
            id={`${fieldId}-interval`}
            label={t('settings.refreshInterval')}
            control={(
              // Seconds here, milliseconds on the wire: a person setting a poll cadence thinks in
              // seconds, while the section's unit is fixed by the schema it shares with cordis.yml.
              <input
                id={`${fieldId}-interval`}
                className={intervalInvalid ? css.inputInvalid : css.input}
                type="number"
                min={minimumSeconds}
                step={1}
                inputMode="numeric"
                disabled={disabled}
                {...intervalInvalid ? { 'aria-invalid': true } : {}}
                value={interval}
                onChange={(event) => {
                  setIntervalDraft(event.target.value)
                  // A refusal describes the draft it was judged on; the next keystroke is a new draft.
                  setIntervalRefusal(null)
                  setRefused(({ refreshIntervalMs: _previous, ...kept }) => kept)
                }}
                onBlur={commitInterval}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitInterval()
                }}
              />
            )}
            invalid={intervalInvalid}
            hint={intervalHint()}
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
                  if (next !== '' && !DECIMAL.test(next)) return
                  const write = writeSettings.write('lowBalanceThreshold', next)
                  track('lowBalanceThreshold', write, () => {
                    setThresholdDraft(current => (current === next ? null : current))
                  })
                }}
              />
            )}
            invalid={thresholdInvalid || refused.lowBalanceThreshold === true}
            hint={thresholdInvalid
              ? t('settings.lowBalanceThreshold.invalid')
              : refused.lowBalanceThreshold === true
                ? t('settings.saveFailed')
                : t('settings.lowBalanceThreshold.hint')}
          />

          <Field
            id={`${fieldId}-currency`}
            label={t('settings.costCurrency')}
            control={(
              <input
                id={`${fieldId}-currency`}
                className={currencyInvalid ? css.inputInvalid : css.input}
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="USD"
                disabled={disabled}
                {...currencyInvalid ? { 'aria-invalid': true } : {}}
                value={currency}
                onChange={(event) => {
                  const next = event.target.value.toUpperCase()
                  setCurrencyDraft(next)
                  if (!CURRENCY.test(next)) return
                  const write = writeSettings.write('costCurrency', next)
                  track('costCurrency', write, () => {
                    setCurrencyDraft(current => (current === next ? null : current))
                  })
                }}
              />
            )}
            invalid={currencyInvalid || refused.costCurrency === true}
            hint={currencyInvalid
              ? t('settings.costCurrency.invalid')
              : refused.costCurrency === true
                ? t('settings.saveFailed')
                : t('settings.costCurrency.hint')}
          />

          {RATE_FIELDS.map(({ key, label }) => {
            const rate = rateDraft[key] ?? value?.costRates[key] ?? ''
            const invalid = rate !== '' && !RATE.test(rate)
            const rateRefused = refused[`costRates.${key}`] === true
            return (
              <Field
                key={key}
                id={`${fieldId}-rate-${key}`}
                label={t(label)}
                control={(
                  <input
                    id={`${fieldId}-rate-${key}`}
                    className={invalid ? css.inputInvalid : css.input}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={disabled}
                    {...invalid ? { 'aria-invalid': true } : {}}
                    value={rate}
                    onChange={(event) => {
                      const next = event.target.value
                      setRateDraft(current => ({ ...current, [key]: next }))
                      if (RATE.test(next)) writeRate(key, next)
                    }}
                  />
                )}
                invalid={invalid || rateRefused}
                hint={invalid
                  ? t('settings.price.invalid')
                  : rateRefused
                    ? t('settings.saveFailed')
                    // The input rate is the one that also prices cache writes, and that is the whole
                    // reason a session's four buckets can be summed with three rates.
                    : key === 'input' ? t('settings.priceCacheWrite') : t('settings.price.hint')}
              />
            )
          })}
        </div>
      )}
    </li>
  )
}
