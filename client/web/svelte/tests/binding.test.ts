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

vi.mock('@fingerly/web-js', () => ({
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
    consent: options.consent ?? 'granted',
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

const verdict = (value: boolean, confidence: 'low' | 'medium' | 'high', reasons: string[] = []) => ({
  value,
  confidence,
  reasons,
})

const RESULT = {
  requestId: 'req_1',
  visitorId: 'vis_1',
  visitorIsNew: false,
  visitorConfidence: 93,
  identifiable: true,
  duplicate: false,
  state: 'scored',
  reason: '',
  suspectScore: 41,
  suspectLevel: 'medium',
  triggers: [{ signal: 'patched-natives', group: 'automation', weight: 22, confidence: 'high', reason: '' }],
  verdicts: {
    incognito: verdict(true, 'medium', ['firefox-private-origin-filesystem-refused']),
    tor: verdict(false, 'low'),
    emulator: verdict(false, 'low'),
    automation: verdict(true, 'high', ['patched-natives-3']),
    farm: verdict(false, 'low'),
  },
  report: { schema: 1, sources: {}, elapsed_ms: 31 },
}

interface Mounted {
  target: HTMLElement
  text: () => string
  // The whole binding surface, not the one method the tests started with: a
  // stub type here would let a field be added to Fingerly and never asserted on.
  state: Fingerly
  destroy: () => void
}

function render(props: Record<string, unknown>): Mounted {
  const target = document.createElement('div')
  document.body.appendChild(target)

  const component = mount(Page, { target, props }) as unknown as Mounted['state'] & {
    state: Mounted['state']
  }
  flushSync()

  return {
    target,
    text: () => target.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    state: component.state,
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
    render({ options: { apiKey: 'fly_pk_us_development_test' } })

    // Setting up makes the client reachable and no more. A setup that
    // fingerprinted would run during every server render as well.
    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
  })

  it('passes the endpoint through, and omits it when unset', async () => {
    const page = render({ options: { apiKey: 'fly_pk_us_development_test', endpoint: 'http://localhost:8099' } })
    await page.state.identify()

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'fly_pk_us_development_test', endpoint: 'http://localhost:8099', consent: 'granted' })
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
    const page = render({ options: { apiKey: 'fly_pk_us_development_test' }, immediate: true })

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
    const page = render({ options: { apiKey: 'fly_pk_us_development_test' } })

    await page.state.identify()

    expect(page.state.visitorId).toBe('vis_1')
    expect(page.state.visitorIsNew).toBe(false)
    expect(page.state.visitorConfidence).toBe(93)
    expect(page.state.identifiable).toBe(true)
    expect(page.state.duplicate).toBe(false)
    expect(page.state.state).toBe('scored')
    expect(page.state.suspectScore).toBe(41)
    expect(page.state.suspectLevel).toBe('medium')
    expect(page.state.triggers).toHaveLength(1)
    expect(page.state.triggers[0]?.signal).toBe('patched-natives')
    // Empty on the wire means "nothing to say", and null is how this binding
    // says that - so a template can write `reason ?? fallback`.
    expect(page.state.reason).toBeNull()
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
      triggers: [],
    })
    const page = render({ options: { apiKey: 'fly_pk_us_development_test' } })

    await page.state.identify()

    expect(page.state.suspectScore).toBeNull()
    expect(page.state.suspectLevel).toBeNull()
    expect(page.state.visitorId).toBeNull()
    expect(page.state.identifiable).toBe(false)
  })

  it('shares one identification across every component that asks', async () => {
    const page = render({ options: { apiKey: 'fly_pk_us_development_test' }, immediate: true, children: 3 })
    await settle()

    expect(identifyMock).toHaveBeenCalledTimes(1)

    const children = [...page.target.querySelectorAll('.child')].map((node) => node.textContent)
    expect(children).toEqual(['req_1', 'req_1', 'req_1'])
  })

  it('reuses a finished identification rather than repeating it', async () => {
    const page = render({ options: { apiKey: 'fly_pk_us_development_test' } })

    await page.state.identify()
    await page.state.identify()

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh one when forced', async () => {
    const page = render({ options: { apiKey: 'fly_pk_us_development_test' } })

    await page.state.identify()
    await page.state.identify({ force: true })

    expect(identifyMock).toHaveBeenCalledTimes(2)
  })

  it('reads a getter tag at submission time', async () => {
    let orderId = 'order_1'
    const page = render({ options: { apiKey: 'fly_pk_us_development_test' }, tag: () => orderId })

    orderId = 'order_2'
    await page.state.identify()

    expect(identifyMock).toHaveBeenCalledWith({ tag: 'order_2' })
  })

  it('records a failure without leaving an unhandled rejection', async () => {
    identifyMock.mockRejectedValue(new Error('collector exploded'))
    const page = render({ options: { apiKey: 'fly_pk_us_development_test' }, immediate: true })

    await settle()

    expect(page.text()).toContain('error:collector exploded')
    expect(page.text()).toContain('ready:true')
  })

  it('retries after a failure rather than serving the rejection forever', async () => {
    identifyMock.mockRejectedValueOnce(new Error('collector exploded'))
    const page = render({ options: { apiKey: 'fly_pk_us_development_test' } })

    await page.state.identify().catch(() => undefined)
    await page.state.identify()

    expect(identifyMock).toHaveBeenCalledTimes(2)
  })

  it('leaves requestId null when submit is off, and still shares the run', async () => {
    identifyMock.mockResolvedValue({ ...RESULT, requestId: '' })
    const page = render({
      options: { apiKey: 'fly_pk_us_development_test', submit: false },
      immediate: true,
      children: 2,
    })

    await settle()

    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(identifyMock).toHaveBeenCalledWith({ submit: false })
    expect(page.text()).toContain('request:-')
  })
})

describe('useVerdict', () => {
  it('reports one verdict and its reasons', async () => {
    const page = render({ options: { apiKey: 'fly_pk_us_development_test' }, immediate: true })
    await settle()

    expect(page.text()).toContain('incognito:true')
    expect(page.text()).toContain('confidence:medium')
    expect(page.text()).toContain('reasons:firefox-private-origin-filesystem-refused')
  })

  it('honours a confidence floor', async () => {
    const page = render({ options: { apiKey: 'fly_pk_us_development_test' }, immediate: true, min: 'high' })
    await settle()

    // Fired, but at medium - not enough to act on when high was asked for.
    expect(page.text()).toContain('incognito:false')
    expect(page.text()).toContain('confidence:medium')
  })

  it('reports nothing rather than guessing before identification', () => {
    const page = render({ options: { apiKey: 'fly_pk_us_development_test' } })

    expect(page.text()).toContain('incognito:false')
    expect(page.text()).toContain('confidence:-')
    expect(page.text()).toContain('reasons:-')
  })
})

describe('consent', () => {
  it('waits for consent before identifying on mount, then identifies once', async () => {
    const page = render({ options: { apiKey: 'fly_pk_us_development_test', consent: 'pending' }, immediate: true, children: 2 })
    await settle()

    // Not even the client: nothing is loaded while the visitor has not answered.
    expect(loadMock).not.toHaveBeenCalled()
    expect(page.state.consent).toBe('pending')
    expect(page.text()).toContain('request:-')

    page.state.setConsent('granted')
    await settle()

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'fly_pk_us_development_test', consent: 'granted' })
    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(page.text()).toContain('request:req_1')

    page.state.setConsent('denied')
    await settle()
    page.state.setConsent('granted')
    await settle()

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it("follows the client's own setConsent", async () => {
    const page = render({ options: { apiKey: 'fly_pk_us_development_test', consent: 'denied' }, immediate: true })

    const client = await page.state.client()
    client.setConsent('granted')
    await settle()

    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(page.state.consent).toBe('granted')
  })

  it('surfaces a ConsentError from a manual identify through error', async () => {
    const page = render({ options: { apiKey: 'fly_pk_us_development_test', consent: 'pending' } })

    await expect(page.state.identify()).rejects.toMatchObject({ code: 'consent_required' })
    flushSync()

    expect(page.state.error).toBeInstanceOf(ConsentError)
    expect(page.text()).toContain('error:Fingerly needs consent')
    expect(identifyMock).not.toHaveBeenCalled()
  })
})
