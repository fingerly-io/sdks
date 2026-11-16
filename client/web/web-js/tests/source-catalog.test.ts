// @vitest-environment happy-dom

import { SOURCE } from '@fingerly/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { browserSources } from '../src/sources/index.js'
import { automationSource } from '../src/sources/runtime.js'

describe('browser source catalogue (single-pass v3)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('places engine and timing in Stage 1 prerequisite so RFP gate completes before Stage 2', () => {
    const stages = new Map(browserSources.map((source) => [source.id, source.stage ?? 'collect']))
    expect(stages.get(SOURCE.engine)).toBe('prerequisite')
    expect(stages.get(SOURCE.timing)).toBe('prerequisite')
  })

  it('runs canvas, audio, fonts, user_agent_data, worker_realm, shields, and webgl in Stage 2 collect', () => {
    const stages = new Map(browserSources.map((source) => [source.id, source.stage ?? 'collect']))
    for (const id of [
      SOURCE.canvas,
      SOURCE.audio,
      SOURCE.fonts,
      SOURCE.userAgentData,
      SOURCE.workerRealm,
      SOURCE.shields,
      SOURCE.webgl,
      SOURCE.mediaDevices,
      SOURCE.languages,
      SOURCE.vendor,
      SOURCE.screenFrame,
      SOURCE.colorGamut,
      SOURCE.timezone,
      SOURCE.fontPreferences,
    ]) {
      expect(stages.get(id), id).toBe('collect')
    }
  })

  it('marks storage_durability as optIn extended-incognito', () => {
    const durability = browserSources.find((source) => source.id === SOURCE.storageDurability)
    expect(durability).toBeDefined()
    expect(durability?.stage).toBe('collect')
    expect(durability?.optIn).toBe('extended-incognito')
  })

  it('removes retired unread collectors (speech, sensors, battery, dom_blockers)', () => {
    const ids = new Set(browserSources.map((source) => source.id))
    for (const retired of ['speech', 'speech_voices', 'sensors', 'battery', 'dom_blockers']) {
      expect(ids.has(retired), `${retired} must be removed`).toBe(false)
    }
  })

  it('contains no duplicate source ids', () => {
    const ids = browserSources.map((source) => source.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('scans document in addition to window for $cdc_/cdc_ and Playwright bindings', async () => {
    const docRecord = document as unknown as Record<string, unknown>
    const winRecord = window as unknown as Record<string, unknown>
    docRecord.$cdc_asdjflasutopfhvcZLmcfl_ = true
    winRecord.__playwright__binding__ = () => {}
    winRecord.__pwInitScripts = {}
    try {
      const result = await automationSource.run({} as never)
      expect(result.cdp_artifacts).toContain('$cdc_asdjflasutopfhvcZLmcfl_')
      expect(result.distinctive_properties).toEqual(
        expect.arrayContaining(['__playwright__binding__', '__pwInitScripts']),
      )
    } finally {
      delete docRecord.$cdc_asdjflasutopfhvcZLmcfl_
      delete winRecord.__playwright__binding__
      delete winRecord.__pwInitScripts
    }
  })
})
