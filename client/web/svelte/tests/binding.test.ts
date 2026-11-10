/**
 * The binding, mounted as real components.
 *
 * `@fingerly/web-js`'s `load()` is mocked, because what is under test is the
 * Svelte layer - context, sharing, reactivity, the confidence floor - and not
 * whether a canvas hashes. The browser SDK has its own tests for that.
 *
 * Components rather than direct calls to the exported functions: `$effect`
 * only runs inside a component, and context only exists inside one, so a test
 * that called `useIdentify()` on its own would be testing neither.
 */

import { flushSync, mount, unmount } from 'svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Fingerly } from '../src/state.svelte.js'

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
 * The part of a client the binding talks to.
 *
 * Consent behaves as the real client's does - notifying on a change, refusing
 * to identify unless granted - because the binding's job here is to follow it.
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

const Page = (await import('./fixtures/Page.svelte')).default
const Orphan = (await import('./fixtures/Orphan.svelte')).default

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
  report: { schema: 1, sources: {}, elapsed_ms: 31 },
}

interface Mounted {
  target: HTMLElement
  text: () => string
  // The whole binding surface, not the one method the tests started with: a
  // stub type here would let a field be added to Fingerly and never asserted on.
  state: Fingerly
  /** What setupFingerly() returned: the shared state, without the hook's tag wrapper. */
  shared: Fingerly
  destroy: () => void
}

function render(props: Record<string, unknown>): Mounted {
  const target = document.createElement('div')
  document.body.appendChild(target)

  const component = mount(Page, { target, props }) as unknown as Mounted['state'] & {
    state: Mounted['state']
    shared: Mounted['shared']
  }
  flushSync()

  return {
    target,
    text: () => target.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    state: component.state,
    shared: component.shared,
    destroy: () => void unmount(component),
  }
}

/**
 * Let the mocked promises settle, then let Svelte apply what changed.
 *
 * A macrotask rather than a couple of `await Promise.resolve()`: identifying
 * runs through the client promise, the identify promise and a `finally`, and
 * counting the microtasks between them is a test that breaks whenever that
 * chain gains a link.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  flushSync()
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  identifyMock.mockResolvedValue(RESULT)
  loadMock.mockImplementation(async (options: { consent?: string }) => fakeClient(options))
})

describe('setupFingerly', () => {
  it('collects nothing on mount', () => {
    render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' } })

    // Setting up makes the client reachable and no more. A setup that
    // fingerprinted would run during every server render as well.
    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
  })

  it('passes the endpoint through, and omits it when unset', async () => {
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted', endpoints: 'http://localhost:8099' } })
    await page.state.identify()

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'fly_pk_development_test', endpoints: 'http://localhost:8099', consent: 'granted' })
  })
})

describe('useFingerly', () => {
  it('explains itself when nothing was set up', () => {
    const target = document.createElement('div')

    expect(() => mount(Orphan, { target })).toThrow(/No Fingerly context/)
    expect(() => mount(Orphan, { target })).toThrow(/setupFingerly/)
  })
})

describe('useIdentify', () => {
  it('collects on mount when immediate is set, and the template follows', async () => {
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' }, immediate: true })

    expect(page.text()).toContain('ready:false')

    await settle()

    // No store, no subscription, no $ prefix: the template read a property and
    // Svelte re-rendered it.
    expect(page.text()).toContain('ready:true')
    expect(page.text()).toContain('request:req_1')
    expect(page.text()).toContain('suspicious:true')
    expect(page.text()).toContain('loading:false')
  })

  it('surfaces everything the server decided', async () => {
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' } })

    await page.state.identify()

    expect(page.state.visitorId).toBe('vis_1')
    expect(page.state.visitorIsNew).toBe(false)
    expect(page.state.visitorConfidence).toBe(93)
    expect(page.state.identifiable).toBe(true)
    expect(page.state.duplicate).toBe(false)
    expect(page.state.state).toBe('scored')
    expect(page.state.suspectScore).toBe(41)
    expect(page.state.suspectLevel).toBe('medium')
    expect(page.state).not.toHaveProperty('triggers')
    expect(page.state).not.toHaveProperty('verdicts')
    expect(page.state).not.toHaveProperty('reason')
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
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' } })

    await page.state.identify()

    expect(page.state.state).toBe('unavailable')
    expect(page.state).not.toHaveProperty('reason')
  })

  it('reads isSuspicious from the server level', async () => {
    identifyMock.mockResolvedValueOnce({ ...RESULT, suspectLevel: 'low' })
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' } })

    await page.state.identify()
    await settle()

    expect(page.state.isSuspicious).toBe(false)
    expect(page.text()).toContain('suspicious:false')
  })

  it('reports isSuspicious as null when no server scored it', async () => {
    identifyMock.mockResolvedValueOnce({ ...RESULT, suspectLevel: null })
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' } })

    await page.state.identify()
    await settle()

    expect(page.state.isSuspicious).toBeNull()
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
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' } })

    await page.state.identify()

    expect(page.state.suspectScore).toBeNull()
    expect(page.state.suspectLevel).toBeNull()
    expect(page.state.visitorId).toBeNull()
    expect(page.state.identifiable).toBe(false)
  })

  it('shares one identification across every component that asks', async () => {
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' }, immediate: true, children: 3 })
    await settle()

    expect(identifyMock).toHaveBeenCalledTimes(1)

    const children = [...page.target.querySelectorAll('.child')].map((node) => node.textContent)
    expect(children).toEqual(['req_1', 'req_1', 'req_1'])
  })

  it('reuses a finished identification rather than repeating it', async () => {
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' } })

    await page.state.identify()
    await page.state.identify()

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh one when forced', async () => {
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' } })

    await page.state.identify()
    await page.state.identify({ force: true })

    expect(identifyMock).toHaveBeenCalledTimes(2)
  })

  it('reads a getter tag at submission time', async () => {
    let orderId = 'order_1'
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' }, tag: () => orderId })

    orderId = 'order_2'
    await page.state.identify()

    expect(identifyMock).toHaveBeenCalledWith({ tag: 'order_2' })
  })

  it('records a failure without leaving an unhandled rejection', async () => {
    identifyMock.mockRejectedValue(new Error('collector exploded'))
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' }, immediate: true })

    await settle()

    expect(page.text()).toContain('error:collector exploded')
    expect(page.text()).toContain('ready:true')
  })

  it('keeps working when the client cannot be built', async () => {
    // A synchronous throw out of load() used to escape the effect and leave
    // isLoading stuck at true.
    loadMock.mockImplementation(() => {
      throw new Error('An SDK key is required')
    })
    const page = render({ options: { apiKey: '', consent: 'granted' }, immediate: true })

    await settle()

    expect(page.text()).toContain('error:An SDK key is required')
    expect(page.text()).toContain('loading:false')
  })

  it('retries after a failure rather than serving the rejection forever', async () => {
    identifyMock.mockRejectedValueOnce(new Error('collector exploded'))
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' } })

    await page.state.identify().catch(() => undefined)
    await page.state.identify()

    expect(identifyMock).toHaveBeenCalledTimes(2)
  })

  it('holds every identification for as long as Retry-After asked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const limited = Object.assign(new Error('The server refused the submission (429)'), { status: 429, retryable: true, retryAfterMs: 30_000 })
      identifyMock.mockRejectedValue(limited)
      const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' }, immediate: true })
      await settle()

      for (let i = 0; i < 5; i++) await page.shared.identify({ automatic: true }).catch(() => undefined)
      await expect(page.state.refresh()).rejects.toBe(limited)
      expect(identifyMock).toHaveBeenCalledTimes(1)

      vi.setSystemTime(Date.now() + 30_001)
      identifyMock.mockResolvedValue(RESULT)
      await page.state.refresh()
      expect(identifyMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds automatic identifications after a transient failure, but not a click', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      identifyMock.mockRejectedValue(Object.assign(new Error('Failed to fetch'), { retryable: true }))
      const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' }, immediate: true })
      await settle()
      // What a component mounting with immediate does, as on a route change.
      for (let i = 0; i < 4; i++) await page.shared.identify({ automatic: true }).catch(() => undefined)
      expect(identifyMock).toHaveBeenCalledTimes(1)

      await expect(page.state.identify()).rejects.toThrow('Failed to fetch')
      expect(identifyMock).toHaveBeenCalledTimes(2)

      vi.setSystemTime(Date.now() + 60_001)
      await page.shared.identify({ automatic: true }).catch(() => undefined)
      expect(identifyMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves requestId null when submit is off, and still shares the run', async () => {
    identifyMock.mockResolvedValue({ ...RESULT, requestId: '' })
    const page = render({
      options: { apiKey: 'fly_pk_development_test', consent: 'granted', submit: false },
      immediate: true,
      children: 2,
    })

    await settle()

    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(identifyMock).toHaveBeenCalledWith({ submit: false })
    expect(page.text()).toContain('request:-')
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
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'granted' }, immediate: true })
    await vi.waitFor(() => {
      flushSync()
      expect(page.state.isReady).toBe(true)
    })

    expect(page.state.error).toBeNull()
    expect(page.state.requestId).toBe('req_public')
    expect(page.state.suspectScore).toBe(score)
    expect(page.state.suspectLevel).toBe(level)
    expect(page.state.isSuspicious).toBe(suspicious)
    expect(page.state).not.toHaveProperty('triggers')
    expect(page.state).not.toHaveProperty('verdicts')
  })
})

describe('consent', () => {
  it('defaults to pending, so nothing identifies on mount until consent is granted', async () => {
    const page = render({ options: { apiKey: 'fly_pk_development_test' }, immediate: true })
    await settle()

    expect(page.state.consent).toBe('pending')
    expect(loadMock).not.toHaveBeenCalled()
    await expect(page.state.identify()).rejects.toMatchObject({ code: 'consent_required' })
    expect(identifyMock).not.toHaveBeenCalled()

    page.state.setConsent('granted')
    await settle()

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('waits for consent before identifying on mount, then identifies once', async () => {
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'pending' }, immediate: true, children: 2 })
    await settle()

    // Not even the client: nothing is loaded while the visitor has not answered.
    expect(loadMock).not.toHaveBeenCalled()
    expect(page.state.consent).toBe('pending')
    expect(page.text()).toContain('request:-')

    page.state.setConsent('granted')
    await settle()

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(page.text()).toContain('request:req_1')

    page.state.setConsent('denied')
    await settle()
    page.state.setConsent('granted')
    await settle()

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it("follows the client's own setConsent", async () => {
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'denied' }, immediate: true })

    const client = await page.state.client()
    client.setConsent('granted')
    await settle()

    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(page.state.consent).toBe('granted')
  })

  it('surfaces a ConsentError from a manual identify through error', async () => {
    const page = render({ options: { apiKey: 'fly_pk_development_test', consent: 'pending' } })

    await expect(page.state.identify()).rejects.toMatchObject({ code: 'consent_required' })
    flushSync()

    expect(page.state.error).toBeInstanceOf(ConsentError)
    expect(page.text()).toContain('error:Fingerly needs consent')
    expect(identifyMock).not.toHaveBeenCalled()
  })
})
