/**
 * The composables, mounted in real components.
 *
 * `@fingerly/web-js`'s `load()` is mocked, because what is under test here is the
 * Vue layer - sharing, readiness, readonly-ness, SSR safety - and not whether a
 * canvas hashes. The browser SDK has its own tests for that.
 */

import { defineComponent, nextTick, type App } from 'vue'
import { createApp, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const identifyMock = vi.fn()
const loadMock = vi.fn()

vi.mock('@fingerly/web-js', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  load: (...args: unknown[]) => loadMock(...args),
  TransportError: class TransportError extends Error {},
  ConsentError,
}))

class ConsentError extends Error {
  readonly code = 'consent_required'
  constructor(readonly state: string) {
    super(`Fingerly needs consent before it can identify this visitor (consent is ${state})`)
  }
}

/**
 * The part of a client the plugin talks to.
 *
 * Consent behaves as the real client's does - notifying on a change, refusing
 * to identify unless granted - because the plugin's job here is to follow it.
 * `identifyMock` counts only the identifications that were allowed to run.
 */
function fakeClient(options: { consent?: string } = {}) {
  const listeners = new Set<(state: string) => void>()
  const client = {
    consent: options.consent ?? 'pending',
    identify: (...args: unknown[]) =>
      client.consent === 'granted' ? identifyMock(...args) : Promise.reject(new ConsentError(client.consent)),
    setConsent: (state: string) => {
      if (state === client.consent) return
      client.consent = state
      for (const listener of [...listeners]) listener(state)
    },
    onConsentChange: (listener: (state: string) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return client
}

const { createFingerly } = await import('../src/plugin.js')
const { useFingerly } = await import('../src/useFingerly.js')
const { useIdentify } = await import('../src/useIdentify.js')

const RESULT = {
  requestId: 'req_1',
  visitorId: 'vis_1',
  visitorIsNew: false,
  visitorConfidence: 93,
  identifiable: true,
  duplicate: false,
  state: 'scored',
  suspectScore: 41,
  suspectLevel: 'medium',
  report: { schema: 1, sources: {}, elapsed_ms: 29 },
}

/**
 * Mount a component that runs `use` in setup, and hand back what it returned.
 *
 * Composables have to be called inside `setup()`, so a test that wants to poke
 * at one needs a component around it - this is that component, once, rather
 * than in every test.
 */
function withSetup<T>(use: () => T, plugin?: ReturnType<typeof createFingerly>): { result: T; app: App } {
  let result!: T

  const app = createApp(
    defineComponent({
      setup() {
        result = use()
        return () => h('div')
      },
    }),
  )

  if (plugin) app.use(plugin)
  app.mount(document.createElement('div'))

  return { result, app }
}

/** Lets mount hooks and the promise chains they start settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  identifyMock.mockResolvedValue(RESULT)
  loadMock.mockImplementation(async (options: { consent?: string }) => fakeClient(options))
})

describe('createFingerly', () => {
  it('does not collect anything on install', () => {
    withSetup(() => useFingerly(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))

    // A plugin that fingerprinted on install would run before the app has
    // rendered, and during SSR.
    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
  })

  it('passes the endpoint through, and omits it when unset', async () => {
    const { result } = withSetup(
      () => useIdentify(),
      createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted', endpoints: 'http://localhost:8099' }),
    )
    await result.identify()

    expect(loadMock).toHaveBeenCalledWith({
      apiKey: 'fly_pk_development_test',
      endpoints: 'http://localhost:8099',
      consent: 'granted',
    })
  })

  it('works from an Options-API component via this.$fingerly', async () => {
    // The README documents this path, so it is tested as written rather than
    // by poking at globalProperties: not every Vue 3 component is
    // `<script setup>`, and a fraud check is the kind of thing that gets
    // retrofitted into an older one.
    let level: string | null | undefined

    const app = createApp(
      defineComponent({
        async mounted() {
          const { suspectLevel } = await this.$fingerly.identify()
          level = suspectLevel
        },
        render: () => h('div'),
      }),
    )
    app.use(createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))
    app.mount(document.createElement('div'))

    await vi.waitFor(() => expect(level).toBe('medium'))
  })

  it('still shares one identification when submit is off', async () => {
    // Regression. The cache used to key on requestId, which is empty under
    // `submit: false` - so the cache never engaged and every component
    // re-collected the entire fingerprint. Found in a browser, not here,
    // because the mock returns a requestId by default.
    identifyMock.mockResolvedValue({ ...RESULT, requestId: '' })

    const plugin = createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted', submit: false })
    const a = withSetup(() => useIdentify(), plugin).result
    const b = withSetup(() => useIdentify(), plugin).result

    await a.identify()
    await b.identify()
    await a.identify()

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('leaves requestId null when submit is off', async () => {
    // The client reports an empty requestId when nothing was sent. Surfacing
    // that as `null` rather than `''` is the honest answer: there is nothing to
    // fetch later, and an empty string reads like an identifier.
    identifyMock.mockResolvedValueOnce({ ...RESULT, requestId: '' })

    const { result } = withSetup(
      () => useIdentify(),
      createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted', submit: false }),
    )
    await result.identify()

    expect(identifyMock).toHaveBeenCalledWith({ submit: false })
    expect(result.requestId.value).toBeNull()
    expect(result.report.value).not.toBeNull()
  })
})

describe('useFingerly', () => {
  // Declared before the test below, and that ordering is load-bearing: a
  // `setup()` that throws leaves Vue's `currentInstance` dangling, so
  // `hasInjectionContext()` keeps reporting true for the rest of the file.
  // Verified against Vue 3.5.42. Asserting the outside-setup case first is the
  // only way to observe it honestly.
  it('explains itself when called outside setup', () => {
    expect(() => useFingerly()).toThrow(/must be called from setup\(\)/)
  })

  it('explains itself when the plugin is missing', () => {
    // Without the message, this surfaces as "cannot read properties of
    // undefined" several frames away from the actual mistake.
    expect(() => withSetup(() => useFingerly())).toThrow(/No Fingerly plugin found/)
  })
})

describe('useIdentify', () => {
  it('collects, and exposes the result reactively', async () => {
    const { result } = withSetup(() => useIdentify(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))

    expect(result.isReady.value).toBe(false)
    expect(result.isLoading.value).toBe(false)

    const pending = result.identify()
    expect(result.isLoading.value).toBe(true)

    await pending
    await nextTick()

    expect(result.isLoading.value).toBe(false)
    expect(result.isReady.value).toBe(true)
    expect(result.requestId.value).toBe('req_1')
  })

  it('shares one identification across every component that asks', async () => {
    const plugin = createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' })

    const a = withSetup(() => useIdentify(), plugin).result
    const b = withSetup(() => useIdentify(), plugin).result
    const c = withSetup(() => useIdentify(), plugin).result

    await Promise.all([a.identify(), b.identify(), c.identify()])

    // The whole reason state lives on the app: three components asking is one
    // submission, one requestId, and one line on the customer's bill.
    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(a.requestId.value).toBe('req_1')
    expect(b.requestId.value).toBe('req_1')
    expect(c.requestId.value).toBe('req_1')
  })

  it('reuses a finished identification rather than repeating it', async () => {
    const { result } = withSetup(() => useIdentify(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))

    await result.identify()
    await result.identify()
    await result.identify()

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('hands a cached call the same answer as the first one', async () => {
    // Regression, and the reason this file asserts on whole objects rather
    // than a field or two. The cached branch does not replay the first
    // promise - it *rebuilds* a result from the stored refs, so any field
    // added to IdentifyResult and forgotten there makes the second caller
    // silently poorer than the first. The second caller is the common one:
    // every component after the first takes this path.
    const { result } = withSetup(() => useIdentify(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))

    const first = await result.identify()
    const cached = await result.identify()

    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(cached).toEqual(first)
  })

  it('surfaces everything the server decided', async () => {
    const { result } = withSetup(() => useIdentify(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))

    await result.identify()

    expect(result.visitorId.value).toBe('vis_1')
    expect(result.visitorIsNew.value).toBe(false)
    expect(result.visitorConfidence.value).toBe(93)
    expect(result.identifiable.value).toBe(true)
    expect(result.duplicate.value).toBe(false)
    expect(result.state.value).toBe('scored')
    expect(result.suspectScore.value).toBe(41)
    expect(result.suspectLevel.value).toBe('medium')
    expect(result).not.toHaveProperty('triggers')
    expect(result).not.toHaveProperty('verdicts')
    expect(result).not.toHaveProperty('reason')
  })

  it('never surfaces why a check went unscored, which only a backend is told', async () => {
    identifyMock.mockResolvedValueOnce({
      ...RESULT,
      state: 'unavailable',
      // As a custom transport might pass it on. The binding does not.
      reason: 'ip-database-not-loaded',
      suspectScore: null,
      suspectLevel: null,
    })
    const { result } = withSetup(() => useIdentify(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))

    await result.identify()

    expect(result.state.value).toBe('unavailable')
    expect(result).not.toHaveProperty('reason')
  })

  it('reports an unscored check as null, not zero', async () => {
    // Null and zero are different answers. Zero is "we scored it and found
    // nothing"; null is "nobody scored it". A binding that collapsed them
    // would make an unsubmitted page look clean.
    identifyMock.mockResolvedValueOnce({
      ...RESULT,
      requestId: '',
      visitorId: '',
      identifiable: false,
      suspectScore: null,
      suspectLevel: null,
    })
    const { result } = withSetup(() => useIdentify(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))

    await result.identify()

    expect(result.suspectScore.value).toBeNull()
    expect(result.suspectLevel.value).toBeNull()
    expect(result.visitorId.value).toBeNull()
    expect(result.identifiable.value).toBe(false)
  })

  it('starts a fresh one on refresh()', async () => {
    const { result } = withSetup(() => useIdentify(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))

    await result.identify()
    identifyMock.mockResolvedValueOnce({ ...RESULT, requestId: 'req_2' })
    await result.refresh()

    expect(identifyMock).toHaveBeenCalledTimes(2)
    expect(result.requestId.value).toBe('req_2')
  })

  it('runs on mount when immediate is set', async () => {
    const { result } = withSetup(
      () => useIdentify({ immediate: true }),
      createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }),
    )

    await vi.waitFor(() => expect(result.isReady.value).toBe(true))
    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('reads a reactive tag at submission time, not at setup time', async () => {
    let order = 'order-1'
    const { result } = withSetup(
      () => useIdentify({ tag: () => order }),
      createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }),
    )

    order = 'order-2'
    await result.identify()

    expect(identifyMock).toHaveBeenCalledWith({ tag: 'order-2' })
  })

  it('records a failure without leaving an unhandled rejection', async () => {
    const failure = new Error('network down')
    identifyMock.mockRejectedValueOnce(failure)

    const { result } = withSetup(() => useIdentify(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))

    await expect(result.identify()).rejects.toThrow('network down')

    // Both: awaited callers can catch it, and templates can watch it.
    expect(result.error.value).toBe(failure)
    expect(result.isLoading.value).toBe(false)
    expect(result.isReady.value).toBe(true)
  })

  it('keeps the app mounted when the client cannot be built', async () => {
    // A synchronous throw out of load() used to escape onMounted and fail the
    // whole app's mount (in Nuxt, its start).
    loadMock.mockImplementation(() => {
      throw new Error('An SDK key is required')
    })
    const { result } = withSetup(() => useIdentify({ immediate: true }), createFingerly({ apiKey: '', consent: 'granted' }))
    await flush()

    expect(result.error.value?.message).toBe('An SDK key is required')
    expect(result.isLoading.value).toBe(false)
  })

  it('holds every identification for as long as Retry-After asked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const limited = Object.assign(new Error('The server refused the submission (429)'), { status: 429, retryable: true, retryAfterMs: 30_000 })
      identifyMock.mockRejectedValue(limited)
      const plugin = createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' })
      const { result } = withSetup(() => useIdentify(), plugin)
      await expect(result.identify()).rejects.toBe(limited)

      // Route changes: more components mounting with immediate, on the same plugin.
      for (let i = 0; i < 5; i++) withSetup(() => useIdentify({ immediate: true }), plugin)
      await flush()
      await expect(result.refresh()).rejects.toBe(limited)
      expect(identifyMock).toHaveBeenCalledTimes(1)

      vi.setSystemTime(Date.now() + 30_001)
      identifyMock.mockResolvedValue(RESULT)
      await result.refresh()
      expect(identifyMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds automatic identifications after a transient failure, but not a click', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      identifyMock.mockRejectedValue(Object.assign(new Error('Failed to fetch'), { retryable: true }))
      const plugin = createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' })
      withSetup(() => useIdentify({ immediate: true }), plugin)
      await flush()
      for (let i = 0; i < 4; i++) withSetup(() => useIdentify({ immediate: true }), plugin)
      await flush()
      expect(identifyMock).toHaveBeenCalledTimes(1)

      const { result } = withSetup(() => useIdentify(), plugin)
      await expect(result.identify()).rejects.toThrow('Failed to fetch')
      expect(identifyMock).toHaveBeenCalledTimes(2)

      vi.setSystemTime(Date.now() + 60_001)
      withSetup(() => useIdentify({ immediate: true }), plugin)
      await flush()
      expect(identifyMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns state that a component cannot assign to', async () => {
    const { result } = withSetup(() => useIdentify(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))
    await result.identify()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    // Vue's `readonly()` refuses the write and warns; it does not throw. The
    // assertion is therefore that the value survived, which is the property
    // that matters: shared state a component could write to would be one
    // component silently changing what every other component sees.
    ;(result.requestId as { value: string }).value = 'tampered'

    expect(result.requestId.value).toBe('req_1')
    // That it warned at all, not the wording - the message is Vue's internal
    // and pinning it here would make this test fail on a Vue upgrade that
    // changed nothing we care about.
    expect(warn).toHaveBeenCalled()

    warn.mockRestore()
  })

  describe('isSuspicious', () => {
    it('is true for a medium or high server level', async () => {
      const { result } = withSetup(() => useIdentify(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))
      await result.identify()
      expect(result.isSuspicious.value).toBe(true)
    })

    it('is false for a low server level', async () => {
      identifyMock.mockResolvedValueOnce({ ...RESULT, suspectLevel: 'low' })

      const { result } = withSetup(() => useIdentify(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))
      await result.identify()

      expect(result.isSuspicious.value).toBe(false)
    })

    it('is null when no server scored it, which is not a clean result', async () => {
      identifyMock.mockResolvedValueOnce({ ...RESULT, suspectLevel: null })

      const { result } = withSetup(() => useIdentify(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))
      await result.identify()

      expect(result.isSuspicious.value).toBeNull()
    })

    it('is null before anything has been collected', () => {
      const { result } = withSetup(() => useIdentify(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' }))
      expect(result.isSuspicious.value).toBeNull()
    })
  })
})

// The server's answers, through the real client rather than a fake result:
// mapping them is exactly what is under test.
const OLD_TRIGGER = { signal: 'automation', group: 'bot', weight: 9, confidence: 'high', reason: 'cdp-artifacts-1' }
const PUBLIC_ANSWERS = [
  ['a score', { suspect_score: 7, suspect_level: 'low' }, 7, 'low', false],
  ['no score', {}, null, null, null],
  ['a proxy passing signals through', { suspect_score: 22, suspect_level: 'medium', triggers: [OLD_TRIGGER] }, 22, 'medium', true],
] as const

async function answering(answer: Record<string, unknown>) {
  const { FingerlyClient } = await import('@fingerly/web-js')
  const transport = { submit: async () => ({ request_id: 'req_public', ...answer }) }
  loadMock.mockImplementation(
    async () => new FingerlyClient({ apiKey: 'fly_pk_development_test', consent: 'granted', transport, sources: [] }),
  )
}

describe('a public response', () => {
  it.each(PUBLIC_ANSWERS)('%s: absent stays null and no signal is surfaced', async (_name, answer, score, level, suspicious) => {
    await answering(answer)
    const plugin = createFingerly({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    const identifier = withSetup(() => useIdentify(), plugin).result

    await identifier.identify()

    expect(identifier.error.value).toBeNull()
    expect(identifier.requestId.value).toBe('req_public')
    expect(identifier.suspectScore.value).toBe(score)
    expect(identifier.suspectLevel.value).toBe(level)
    expect(identifier.isSuspicious.value).toBe(suspicious)
    expect(identifier).not.toHaveProperty('triggers')
    expect(identifier).not.toHaveProperty('verdicts')
  })
})

describe('consent', () => {
  it('defaults to pending, so nothing identifies on mount until consent is granted', async () => {
    const { result } = withSetup(
      () => ({ identify: useIdentify({ immediate: true }), fingerly: useFingerly() }),
      createFingerly({ apiKey: 'fly_pk_development_test' }),
    )
    await nextTick()

    expect(result.identify.consent.value).toBe('pending')
    expect(loadMock).not.toHaveBeenCalled()
    await expect(result.identify.identify()).rejects.toMatchObject({ code: 'consent_required' })
    expect(identifyMock).not.toHaveBeenCalled()

    result.fingerly.setConsent('granted')
    await vi.waitFor(() => expect(identifyMock).toHaveBeenCalledTimes(1))
  })

  it('waits for consent before identifying on mount, then identifies once', async () => {
    const { result } = withSetup(
      () => ({ identify: useIdentify({ immediate: true }), fingerly: useFingerly() }),
      createFingerly({ apiKey: 'fly_pk_development_test', consent: 'pending' }),
    )
    await nextTick()

    // Not even the client: nothing is loaded while the visitor has not answered.
    expect(loadMock).not.toHaveBeenCalled()
    expect(result.identify.consent.value).toBe('pending')
    expect(result.identify.error.value).toBeNull()

    result.fingerly.setConsent('granted')
    await vi.waitFor(() => expect(result.identify.requestId.value).toBe('req_1'))

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    expect(identifyMock).toHaveBeenCalledTimes(1)

    result.fingerly.setConsent('denied')
    await nextTick()
    result.fingerly.setConsent('granted')
    await nextTick()

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it("follows the client's own setConsent", async () => {
    const { result } = withSetup(
      () => ({ identify: useIdentify({ immediate: true }), fingerly: useFingerly() }),
      createFingerly({ apiKey: 'fly_pk_development_test', consent: 'denied' }),
    )

    const client = await result.fingerly.client()
    client.setConsent('granted')

    await vi.waitFor(() => expect(identifyMock).toHaveBeenCalledTimes(1))
    expect(result.identify.consent.value).toBe('granted')
  })

  it('surfaces a ConsentError from a manual identify through error', async () => {
    const { result } = withSetup(() => useIdentify(), createFingerly({ apiKey: 'fly_pk_development_test', consent: 'pending' }))

    await expect(result.identify()).rejects.toMatchObject({ code: 'consent_required' })

    expect(result.error.value).toBeInstanceOf(ConsentError)
    expect(identifyMock).not.toHaveBeenCalled()
  })
})
