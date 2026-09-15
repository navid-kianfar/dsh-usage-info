import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

/** The `{name}` placeholders one message interpolates, sorted. */
const placeholders = (message: string): readonly string[] =>
  [...message.matchAll(/\{(\w+)\}/gu)].map(match => match[1] ?? '').sort()

describe('usageInfo dictionaries', () => {
  it('interpolate the same placeholders in both languages', () => {
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]))
    }
  })

  it('do not point the header panel at rates it does not show', () => {
    // The estimate's footnote renders in the session header, where no rates are on screen; the rates
    // live on the settings card, and both languages have to say so.
    expect(en['cost.estimate']).not.toMatch(/below/u)
    expect(en['cost.estimate']).toMatch(/settings/u)
    expect(zh['cost.estimate']).toMatch(/设置中/u)
  })
})
