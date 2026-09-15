import { SOURCE } from '@fingerly/core'
import { describe, expect, it } from 'vitest'

import { browserSources } from '../src/sources/index.js'

describe('browser source catalogue', () => {
  it('wires every formerly declared-only collector into the intended tier', () => {
    const tiers = new Map(browserSources.map((source) => [source.id, source.tier]))
    for (const id of [SOURCE.languages, SOURCE.plugins, SOURCE.vendor, SOURCE.screenFrame, SOURCE.colorGamut, SOURCE.timezone]) {
      expect(tiers.get(id), id).toBe('fast')
    }
    for (const id of [SOURCE.fontPreferences, SOURCE.battery, SOURCE.speech]) {
      expect(tiers.get(id), id).toBe('deferred')
    }
    expect(tiers.get(SOURCE.webgl)).toBe('fast')
  })

  it('contains no duplicate source ids', () => {
    const ids = browserSources.map((source) => source.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
