import { useCallback, useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the session-header utilities seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the `contextPressure` / `contextBreakdown` projection key merges.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { UsageBalanceResult, UsageBalanceSuccess, UsageInfoView } from '../host/types.ts'
import { contextOccupancy, contextParts, formatTokens } from './context.ts'
import { sessionCost, type UsageTokens } from './cost.ts'
import { formatAmount, formatDecimal, isLowBalance, readingAge } from './money.ts'
import type { UsageInfoKey } from './locales.ts'
import type { UsageReadoutInjected } from './index.ts'
import css from './UsageReadout.module.css'

/** Full readout props: runtime share (standard kit + header owner) & injected share & locale seat. */
export type UsageReadoutProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<UsageReadoutInjected>
  & PropsLocale<'usageInfo'>

/** Ring geometry: 14px viewBox, 2px stroke. */
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** How often the open panel re-renders so the reading's age stays honest while a person reads it. */
const AGE_TICK_MS = 30_000

/** Panel legend rows in prompt order; each color class carries the shared swatch and segment tint. */
const PART_LABELS = {
  systemTokens: 'context.system',
  toolsTokens: 'context.tools',
  messageTokens: 'context.messages',
} as const

/** Per-part tint, keyed the same way so a row's swatch and its bar segment cannot drift apart. */
const PART_COLORS = {
  systemTokens: css.colorSystem,
  toolsTokens: css.colorTools,
  messageTokens: css.colorMessages,
} as const

/**
 * The cost estimate's rows, in the order a provider bills them: what it read in full, what it stored,
 * what it reused, and what it wrote back.
 *
 * Cache writes are listed even though they carry no rate of their own — a bucket that is billed at
 * another bucket's rate still has to be legible, or a session's totals would not add up to its figure.
 */
const COST_ROWS = [
  { key: 'uncachedInputTokens', label: 'cost.input' },
  { key: 'cacheWriteTokens', label: 'cost.cacheWrite' },
  { key: 'cacheReadTokens', label: 'cost.cacheRead' },
  { key: 'outputTokens', label: 'cost.output' },
] as const satisfies readonly { key: keyof UsageTokens; label: UsageInfoKey }[]

/**
 * Failure classes that will not change without a configuration edit, so polling stops on them.
 *
 * `unsupported` means this base URL publishes no balance endpoint at all and `not-configured` means
 * there is no key to send. Both are permanent from the browser's side: a poll that kept retrying
 * would spend a request every interval, forever, to be told the same thing.
 */
const TERMINAL_CODES: ReadonlySet<string> = new Set(['unsupported', 'not-configured', 'no-provider'])

/**
 * Operator-facing copy for one balance failure. Error surfaces stay English by repository policy, so
 * these are literals rather than dictionary keys.
 * @param code - the classified failure from the Host.
 * @returns a short operator-facing line.
 */
function describeFailure(code: string): string {
  switch (code) {
    case 'no-provider': return 'no balance provider'
    case 'not-configured': return 'no API key for the balance provider'
    case 'unauthorized': return 'the balance endpoint rejected the API key'
    case 'unsupported': return 'this endpoint publishes no balance'
    case 'provider-timeout': return 'the balance endpoint timed out'
    case 'provider-unavailable': return 'the balance endpoint is unreachable'
    default: return 'could not read the balance'
  }
}

/**
 * The session header's usage readout: how full the model's context window is, what this session has
 * cost so far, and what the account paying for it currently holds.
 *
 * The three halves reach this component by different routes on purpose. Context occupancy and the
 * session's token totals are read straight from the session projections the harness's token meter
 * already publishes — no request, and no second copy of numbers the Host has already folded. Cost is
 * the token totals priced at rates the deployment configures, computed here because that is where the
 * tokens already are. The balance cannot work that way: it needs an API key, so it crosses one Remote
 * call and the browser never sees the credential.
 *
 * The whole readout renders nothing when it has nothing to say — no provider, no capacity reported
 * yet, all halves switched off — rather than showing a control that does not work.
 */
export function UsageReadout({ useProjection, describeUsage, readBalance, t }: UsageReadoutProps) {
  const pressure = useProjection('contextPressure')
  const breakdown = useProjection('contextBreakdown')
  const usage = useProjection('tokenUsage')
  const [view, setView] = useState<UsageInfoView | null>(null)
  const [balance, setBalance] = useState<UsageBalanceResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [ageNow, setAgeNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const aliveRef = useRef(true)
  // Read through a call rather than the property: an `await` can unmount this component, but the
  // compiler narrows `aliveRef.current` after the first check and would treat every later one as
  // dead code.
  const alive = (): boolean => aliveRef.current

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  useEffect(() => {
    void describeUsage().then((next) => {
      if (alive()) setView(next)
    }, () => {
      // A failed probe leaves `view` null, which renders the same as a deployment that switched both
      // halves off: nothing at all. There is no partial state worth showing from a Host that did not
      // answer the question of what this readout is allowed to display.
    })
  }, [describeUsage])

  const refresh = useCallback((force: boolean): void => {
    setLoading(true)
    void readBalance(force).then((next) => {
      if (!alive()) return
      setBalance(next)
      setAgeNow(Date.now())
      setLoading(false)
    }, () => {
      // A transport failure is not a balance failure: the previous reading (if any) stays on screen
      // rather than being replaced by an error the next poll will probably clear on its own.
      if (alive()) setLoading(false)
    })
  }, [readBalance])

  const wantsBalance = view !== null && view.showBalance && view.balanceAvailable
  const halted = balance !== null && !balance.ok && TERMINAL_CODES.has(balance.code)

  useEffect(() => {
    if (!wantsBalance || halted) return undefined
    refresh(false)
    const timer = setInterval(() => { refresh(false) }, view.refreshIntervalMs)
    return () => { clearInterval(timer) }
  }, [wantsBalance, halted, view?.refreshIntervalMs, refresh])

  // Outside click and Escape close, one document listener while open.
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) === true) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // The age line ticks only while someone is looking at it; a closed panel re-reads the clock when
  // the next poll lands, which is the only moment its value can have changed on screen anyway.
  useEffect(() => {
    if (!open) return undefined
    const timer = setInterval(() => { setAgeNow(Date.now()) }, AGE_TICK_MS)
    return () => { clearInterval(timer) }
  }, [open])

  const occupancy = view?.showContext === true ? contextOccupancy(pressure) : null
  // Reading the totals and paying for them are different facts: `sessionCost` answers null until a
  // request has been billed, which is what keeps a brand-new session from reading as costing 0.00.
  const billed = usage ?? null
  const cost = billed === null || view?.costRates === undefined
    ? null
    : sessionCost(billed, view.costRates)
  const showCostSection = view?.showCost === true
  const reading: UsageBalanceSuccess | null = balance?.ok === true ? balance : null
  const showBalanceSection = wantsBalance && !halted
  // A seat with no half to show is not a disabled control — it is no control. The header keeps its own
  // spacing, so an empty utility renders as nothing rather than as a gap.
  if (occupancy === null && !showCostSection && !showBalanceSection) return null

  const primary = reading?.amounts[0]
  const low = primary !== undefined && isLowBalance(primary.total, view?.lowBalanceThreshold)
  const percentText = occupancy === null ? '' : `${occupancy.percent}%`
  const parts = contextParts(breakdown)
  const age = reading === null ? null : readingAge(reading.fetchedAt, ageNow)
  const totalTokens = billed === null
    ? 0
    : billed.uncachedInputTokens + billed.cacheWriteTokens + billed.cacheReadTokens + billed.outputTokens

  return (
    <span ref={rootRef} className={css.root}>
      <Tooltip label={t('readout.title')} side="bottom" delayMs={200} disabled={open}>
        <button
          type="button"
          className={`${css.trigger} ${low ? css.low : ''}`}
          aria-label={t('readout.aria')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(!open) }}
        >
          {occupancy !== null && (
            <>
              <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
                <circle className={css.track} cx="7" cy="7" r={RADIUS} />
                <circle
                  className={css.fill}
                  cx="7"
                  cy="7"
                  r={RADIUS}
                  strokeDasharray={`${CIRCUMFERENCE * occupancy.percent / 100} ${CIRCUMFERENCE}`}
                  transform="rotate(-90 7 7)"
                />
              </svg>
              <span className={css.reading}>{percentText}</span>
            </>
          )}
          {primary !== undefined && (
            <span className={css.reading}>{formatAmount(primary.currency, primary.total)}</span>
          )}
        </button>
      </Tooltip>

      {open && (
        <div className={css.panel} role="dialog" aria-label={t('panel.title')}>
          {view?.showContext === true && (
            <section className={css.section}>
              <div className={css.sectionHead}>
                <span className={css.sectionTitle}>{t('context.title')}</span>
                {occupancy !== null && (
                  <span className={css.figures}>
                    {t('context.figures', {
                      used: `~${formatTokens(occupancy.usedTokens)}`,
                      window: formatTokens(occupancy.contextWindow),
                    })}
                  </span>
                )}
              </div>
              {occupancy === null
                ? <span className={css.muted}>{t('context.pending')}</span>
                : (
                  <>
                    <span className={css.headline}>{t('context.reading', { percent: percentText })}</span>
                    {/* The bar's overall length is the provider-exact percent; the heuristic parts only
                        proportion its colored segments. A zero-width segment is dropped rather than
                        rendered, so an empty context cannot draw a hairline of filled bar. */}
                    <div className={css.bar}>
                      {(parts.length === 0
                        ? [{ key: 'total' as const, color: undefined, width: occupancy.percent }]
                        : parts.map(part => ({
                          key: part.key,
                          color: PART_COLORS[part.key],
                          width: occupancy.percent * part.percent / 100,
                        }))
                      ).filter(segment => segment.width > 0).map(segment => (
                        <div
                          key={segment.key}
                          className={segment.color === undefined ? css.segment : `${css.segment} ${segment.color}`}
                          style={{ width: `${segment.width}%` }}
                        />
                      ))}
                    </div>
                    {parts.length > 0 && (
                      <>
                        <dl className={css.rows}>
                          {parts.map(part => (
                            <div key={part.key} className={css.row}>
                              <dt>
                                <span className={`${css.swatch} ${PART_COLORS[part.key]}`} aria-hidden />
                                {t(PART_LABELS[part.key])}
                              </dt>
                              <dd>{`~${formatTokens(part.tokens)}`}</dd>
                            </div>
                          ))}
                        </dl>
                        <span className={css.muted}>{t('context.approximate')}</span>
                      </>
                    )}
                  </>
                )}
            </section>
          )}

          {showCostSection && (
            <section className={css.section}>
              <div className={css.sectionHead}>
                <span className={css.sectionTitle}>{t('cost.title')}</span>
                {billed !== null && (
                  <span className={css.figures}>{formatTokens(totalTokens)}</span>
                )}
              </div>
              {cost === null || billed === null
                ? <span className={css.muted}>{t('cost.pending')}</span>
                : (
                  <>
                    <span className={css.headline}>
                      {formatAmount(view?.costCurrency ?? 'USD', cost)}
                    </span>
                    {/* Token counts, not money, per row: one figure is what a person is deciding
                        against, while the rows behind it are what a provider reported. */}
                    <dl className={css.rows}>
                      {COST_ROWS.map(row => (
                        <div key={row.key} className={css.row}>
                          <dt>{t(row.label)}</dt>
                          <dd>{formatTokens(billed[row.key])}</dd>
                        </div>
                      ))}
                    </dl>
                    <span className={css.muted}>{t('cost.estimate')}</span>
                  </>
                )}
            </section>
          )}

          {showBalanceSection && (
            <section className={css.section}>
              <div className={css.sectionHead}>
                <span className={css.sectionTitle}>{t('balance.title')}</span>
                <button
                  type="button"
                  className={css.refresh}
                  aria-label={t('balance.refresh')}
                  title={t('balance.refresh')}
                  disabled={loading}
                  onClick={() => { refresh(true) }}
                >
                  {loading ? t('balance.loading') : '↻'}
                </button>
              </div>
              {reading === null && <span className={css.muted}>{t('balance.loading')}</span>}
              {reading !== null && reading.amounts.length === 0 && (
                <span className={css.muted}>{t('balance.empty')}</span>
              )}
              {reading?.amounts.map(amount => (
                <div key={amount.currency} className={css.amount}>
                  <span className={`${css.total} ${isLowBalance(amount.total, view?.lowBalanceThreshold) ? css.low : ''}`}>
                    {formatAmount(amount.currency, amount.total)}
                  </span>
                  <dl className={css.rows}>
                    {amount.granted !== undefined && (
                      <div className={css.row}>
                        <dt>{t('balance.granted')}</dt>
                        <dd>{formatDecimal(amount.granted)}</dd>
                      </div>
                    )}
                    {amount.toppedUp !== undefined && (
                      <div className={css.row}>
                        <dt>{t('balance.toppedUp')}</dt>
                        <dd>{formatDecimal(amount.toppedUp)}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              ))}
              {reading !== null && !reading.available && (
                <span className={css.warn}>{t('balance.suspended')}</span>
              )}
              {low && <span className={css.warn}>{t('balance.low')}</span>}
              {age !== null && (
                <span className={css.muted}>
                  {age.unit === 'now' ? t('balance.age.now') : t(`balance.age.${age.unit}`, { value: String(age.value) })}
                </span>
              )}
              {balance?.ok === false && <span className={css.warn}>{describeFailure(balance.code)}</span>}
            </section>
          )}
        </div>
      )}
    </span>
  )
}
