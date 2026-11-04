/**
 * The hooks, rendered into a real React tree.
 *
 * `@fingerly/web-js`'s `load()` is mocked, because what is under test here is the
 * React layer - sharing, readiness, StrictMode, suspense, SSR safety - and not
 * whether a canvas hashes. The browser SDK has its own tests for that.
 *
 * `react-dom/client` and `act` directly rather than a testing library: the
 * whole surface is four hooks and a provider, and a dependency whose job is to
 * render a component is not worth carrying for that.
 */

import { Component, StrictMode, Suspense, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
 * The part of a client the store talks to.
 *
 * Consent behaves as the real client's does - notifying on a change, refusing
 * to identify unless granted - because the store's job here is to follow it.
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

import type { UseVerdictReturn } from '../src/useVerdict.js'

const { FingerlyProvider } = await import('../src/context.js')
const { useFingerly } = await import('../src/useFingerly.js')
const { useIdentify } = await import('../src/useIdentify.js')
const { useVerdict } = await import('../src/useVerdict.js')

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
  report: { schema: 1, sources: {}, elapsed_ms: 29 },
}

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

interface Rendered {
  container: HTMLElement
  root: Root
  unmount: () => void
}

function render(ui: ReactNode): Rendered {
  const container = document.createElement('div')
  document.body.appendChild(container)

  let root!: Root
  act(() => {
    root = createRoot(container)
    root.render(ui)
  })

  return { container, root, unmount: () => act(() => root.unmount()) }
}

/**
 * The same, awaited.
 *
 * A tree that suspends has to be mounted inside an awaited `act`: React needs
 * somewhere to schedule the retry the resolved promise triggers, and a
 * synchronous `act` says outright that there will be no such opportunity.
 */
async function renderAsync(ui: ReactNode): Promise<Rendered> {
  const container = document.createElement('div')
  document.body.appendChild(container)

  let root!: Root
  await act(async () => {
    root = createRoot(container)
    root.render(ui)
  })

  return { container, root, unmount: () => act(() => root.unmount()) }
}

/**
 * Render a hook and keep the latest value it returned.
 *
 * A hook has to be called from a component, so this is that component - once,
 * rather than in every test.
 */
function probe<T>(use: () => T): { latest: () => T; element: ReactNode } {
  let latest: T
  const Probe = () => {
    latest = use()
    return null
  }
  return { latest: () => latest, element: <Probe /> }
}

/** Catches a render error so a test can assert on it rather than on a crash. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  override render() {
    return this.state.error ? this.state.error.message : this.props.children
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  identifyMock.mockResolvedValue(RESULT)
  loadMock.mockImplementation(async (options: { consent?: string }) => fakeClient(options))
})

describe('FingerlyProvider', () => {
  it('does not collect anything on mount', () => {
    const { element } = probe(() => useFingerly())
    render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>)

    // A provider that fingerprinted as it mounted would collect during the
    // first render of every app that installs it, whether or not the page
    // wanted an answer yet.
    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
  })

  it('passes the endpoint through, and omits it when unset', async () => {
    const { latest, element } = probe(() => useIdentify())
    render(
      <FingerlyProvider apiKey="fly_pk_development_test" consent="granted" endpoint="http://localhost:8099">
        {element}
      </FingerlyProvider>,
    )

    await act(() => latest().identify())

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'fly_pk_development_test', endpoint: 'http://localhost:8099', consent: 'granted' })
  })

  it('survives a parent re-render without rebuilding the store', async () => {
    // The props are an object literal, so a naive provider would build a new
    // store on every render of whatever is above it - discarding the
    // identification and collecting again.
    const { latest, element } = probe(() => useIdentify())
    const { root } = render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>)

    await act(() => latest().identify())
    act(() => root.render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>))
    await act(() => latest().identify())

    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(latest().requestId).toBe('req_1')
  })

  it('keeps the store when endpoints is a new array on every render', async () => {
    // An array literal, or one from a Server Component payload on each
    // router.refresh(), has a new identity per render. Keyed on identity, the
    // store was rebuilt and every component with `immediate` identified again.
    const { latest, element } = probe(() => useIdentify({ immediate: true }))
    const tree = () => (
      <FingerlyProvider apiKey="fly_pk_development_test" consent="granted" endpoints={['/k7x2qm4a']}>
        {element}
      </FingerlyProvider>
    )
    const { root } = render(tree())
    await act(async () => undefined)
    for (let i = 0; i < 5; i++) await act(async () => root.render(tree()))

    expect(loadMock).toHaveBeenCalledTimes(1)
    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(latest().requestId).toBe('req_1')
  })

  it('accepts a store built elsewhere, for one store per request', async () => {
    const { createFingerlyStore } = await import('../src/store.js')
    const store = createFingerlyStore({ apiKey: 'pk_request', consent: 'granted', submit: false })

    const { latest, element } = probe(() => useIdentify())
    render(<FingerlyProvider store={store}>{element}</FingerlyProvider>)

    await act(() => latest().identify())

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'pk_request', consent: 'granted' })
  })
})

describe('useFingerly', () => {
  it('explains itself when the provider is missing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { element } = probe(() => useFingerly())

    const { container } = render(<Boundary>{element}</Boundary>)

    expect(container.textContent).toMatch(/No <FingerlyProvider> found/)
    expect(container.textContent).toMatch(/apiKey/)
  })
})

describe('useIdentify', () => {
  it('collects on mount when immediate is set, and exposes the result', async () => {
    const { latest, element } = probe(() => useIdentify({ immediate: true }))

    await act(async () => {
      render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>)
    })

    expect(latest().isReady).toBe(true)
    expect(latest().isLoading).toBe(false)
    expect(latest().requestId).toBe('req_1')
    expect(latest().verdicts?.automation.value).toBe(true)
    expect(latest().error).toBeNull()
  })

  it('surfaces everything the server decided', async () => {
    const { latest, element } = probe(() => useIdentify({ immediate: true }))

    await act(async () => {
      render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>)
    })

    expect(latest().visitorId).toBe('vis_1')
    expect(latest().visitorIsNew).toBe(false)
    expect(latest().visitorConfidence).toBe(93)
    expect(latest().identifiable).toBe(true)
    expect(latest().duplicate).toBe(false)
    expect(latest().state).toBe('scored')
    expect(latest().suspectScore).toBe(41)
    expect(latest().suspectLevel).toBe('medium')
    expect(latest().triggers).toHaveLength(1)
    expect(latest().triggers[0]?.signal).toBe('patched-natives')
    // A 0.1.1 result has no reason at all. The deprecated field is null, not
    // undefined, so it still matches its type.
    expect(latest().reason).toBeNull()
  })

  it('never surfaces why a check went unscored, which only a backend is told', async () => {
    identifyMock.mockResolvedValueOnce({
      ...RESULT,
      state: 'unavailable',
      // As an older core passed it on. The binding does not.
      reason: 'ip-database-not-loaded',
      suspectScore: null,
      suspectLevel: null,
      triggers: [],
    })
    const { latest, element } = probe(() => useIdentify({ immediate: true }))

    await act(async () => {
      render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>)
    })

    expect(latest().state).toBe('unavailable')
    expect(latest().reason).toBeNull()
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
    const { latest, element } = probe(() => useIdentify({ immediate: true }))

    await act(async () => {
      render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>)
    })

    expect(latest().suspectScore).toBeNull()
    expect(latest().suspectLevel).toBeNull()
    expect(latest().visitorId).toBeNull()
    expect(latest().identifiable).toBe(false)
  })

  it('shares one identification across every component that asks', async () => {
    const a = probe(() => useIdentify({ immediate: true }))
    const b = probe(() => useIdentify({ immediate: true }))
    const c = probe(() => useIdentify({ immediate: true }))

    await act(async () => {
      render(
        <FingerlyProvider apiKey="fly_pk_development_test" consent="granted">
          {a.element}
          {b.element}
          {c.element}
        </FingerlyProvider>,
      )
    })

    // One submission, one answer, three components seeing the same thing.
    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(a.latest().requestId).toBe('req_1')
    expect(b.latest().requestId).toBe('req_1')
    expect(c.latest().report).toBe(a.latest().report)
  })

  it('costs one identification under StrictMode, which mounts twice', async () => {
    // React mounts, unmounts and remounts every component in development to
    // surface effects that are not idempotent. This one is: the store hands
    // back the promise it already has.
    const { element } = probe(() => useIdentify({ immediate: true }))

    await act(async () => {
      render(
        <StrictMode>
          <FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>
        </StrictMode>,
      )
    })

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('reuses a finished identification rather than repeating it', async () => {
    const { latest, element } = probe(() => useIdentify())
    render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>)

    await act(() => latest().identify())
    await act(() => latest().identify())

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh one on refresh()', async () => {
    const { latest, element } = probe(() => useIdentify())
    render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>)

    await act(() => latest().identify())
    await act(() => latest().refresh())

    expect(identifyMock).toHaveBeenCalledTimes(2)
  })

  it('reads a getter tag at submission time, not at render time', async () => {
    let orderId = 'order_1'
    const { latest, element } = probe(() => useIdentify({ tag: () => orderId }))
    render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>)

    orderId = 'order_2'
    await act(() => latest().identify())

    expect(identifyMock).toHaveBeenCalledWith({ tag: 'order_2' })
  })

  it('records a failure without leaving an unhandled rejection', async () => {
    identifyMock.mockRejectedValue(new Error('collector exploded'))
    const { latest, element } = probe(() => useIdentify({ immediate: true }))

    await act(async () => {
      render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>)
    })

    expect(latest().error?.message).toBe('collector exploded')
    expect(latest().isReady).toBe(true)
    expect(latest().isLoading).toBe(false)
  })

  it('keeps the page up when the client cannot be built', async () => {
    // A missing key used to throw synchronously out of load(), past every
    // .catch, and React unmounted the whole root.
    loadMock.mockImplementation(() => {
      throw new Error('An SDK key is required')
    })
    const { latest, element } = probe(() => useIdentify({ immediate: true }))
    let rendered!: Rendered
    await act(async () => {
      rendered = render(<FingerlyProvider apiKey="" consent="granted"><p>page</p>{element}</FingerlyProvider>)
    })

    expect(rendered.container.textContent).toBe('page')
    expect(latest().error?.message).toBe('An SDK key is required')
    expect(latest().isLoading).toBe(false)
  })

  it('retries after a failure rather than serving the rejection forever', async () => {
    identifyMock.mockRejectedValueOnce(new Error('collector exploded'))
    const { latest, element } = probe(() => useIdentify())
    render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>)

    await act(async () => {
      await latest().identify().catch(() => undefined)
    })
    await act(() => latest().identify())

    expect(identifyMock).toHaveBeenCalledTimes(2)
    expect(latest().requestId).toBe('req_1')
  })

  it('holds every identification for as long as Retry-After asked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const limited = Object.assign(new Error('The server refused the submission (429)'), { status: 429, retryable: true, retryAfterMs: 30_000 })
      identifyMock.mockRejectedValue(limited)
      const remounts = probe(() => useIdentify({ immediate: true }))
      const shared = probe(() => useIdentify())
      const { root } = render(
        <FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{shared.element}</FingerlyProvider>,
      )
      await act(async () => {
        await shared.latest().identify().catch(() => undefined)
      })
      for (let i = 0; i < 5; i++) {
        await act(async () => root.render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{shared.element}{i % 2 ? remounts.element : null}</FingerlyProvider>))
      }
      await act(async () => {
        await shared.latest().refresh().catch(() => undefined)
      })
      expect(identifyMock).toHaveBeenCalledTimes(1)
      expect(shared.latest().error).toBe(limited)

      vi.setSystemTime(Date.now() + 30_001)
      identifyMock.mockResolvedValue(RESULT)
      await act(() => shared.latest().refresh())
      expect(identifyMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds automatic identifications after a transient failure, but not a click', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      identifyMock.mockRejectedValue(Object.assign(new Error('Failed to fetch'), { retryable: true }))
      const shared = probe(() => useIdentify())
      const page = probe(() => useIdentify({ immediate: true }))
      const { root } = render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{page.element}</FingerlyProvider>)
      await act(async () => undefined)
      expect(identifyMock).toHaveBeenCalledTimes(1)

      // Unmount and remount the immediate consumer, as a route change does.
      for (let i = 0; i < 4; i++) {
        await act(async () => root.render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{shared.element}</FingerlyProvider>))
        await act(async () => root.render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{shared.element}{page.element}</FingerlyProvider>))
      }
      expect(identifyMock).toHaveBeenCalledTimes(1)

      await act(async () => {
        await shared.latest().identify().catch(() => undefined)
      })
      expect(identifyMock).toHaveBeenCalledTimes(2)

      vi.setSystemTime(Date.now() + 60_001)
      await act(async () => root.render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{shared.element}</FingerlyProvider>))
      await act(async () => root.render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{shared.element}{page.element}</FingerlyProvider>))
      expect(identifyMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves requestId null when submit is off, and still shares the run', async () => {
    identifyMock.mockResolvedValue({ ...RESULT, requestId: '' })

    const a = probe(() => useIdentify({ immediate: true }))
    const b = probe(() => useIdentify({ immediate: true }))

    await act(async () => {
      render(
        <FingerlyProvider apiKey="fly_pk_development_test" consent="granted" submit={false}>
          {a.element}
          {b.element}
        </FingerlyProvider>,
      )
    })

    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(identifyMock).toHaveBeenCalledWith({ submit: false })
    expect(a.latest().requestId).toBeNull()
    expect(b.latest().report).not.toBeNull()
  })

  describe('isSuspicious', () => {
    const withVerdicts = async (verdicts: unknown) => {
      identifyMock.mockResolvedValue({ ...RESULT, verdicts })
      const { latest, element } = probe(() => useIdentify({ immediate: true }))
      await act(async () => {
        render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>)
      })
      return latest
    }

    it('is true for a medium-or-better verdict', async () => {
      const latest = await withVerdicts({ incognito: verdict(true, 'medium') })
      expect(latest().isSuspicious).toBe(true)
    })

    it('ignores low-confidence verdicts, which are one weak tell', async () => {
      const latest = await withVerdicts({ automation: verdict(true, 'low') })
      expect(latest().isSuspicious).toBe(false)
    })

    it('never counts shields, which only says a privacy browser is in use', async () => {
      const latest = await withVerdicts({
        incognito: verdict(false, 'low'),
        shields: verdict(true, 'high', ['brave-api']),
        automation: verdict(false, 'low'),
      })
      expect(latest().isSuspicious).toBe(false)
    })

    it('still counts another verdict when shields is also set', async () => {
      const latest = await withVerdicts({
        shields: verdict(true, 'high', ['brave-api']),
        automation: verdict(true, 'medium', ['navigator-webdriver-true']),
      })
      expect(latest().isSuspicious).toBe(true)
    })

    it('is false before anything has been collected', () => {
      const { latest, element } = probe(() => useIdentify())
      render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>)

      expect(latest().isSuspicious).toBe(false)
      expect(latest().isReady).toBe(false)
    })
  })
})

describe('useVerdict', () => {
  const mount = (use: () => UseVerdictReturn) => {
    const { latest, element } = probe(use)
    const identifier = probe(() => useIdentify({ immediate: true }))
    return { latest, identifier, element }
  }

  it('reports a single verdict and its reasons', async () => {
    const { latest, identifier, element } = mount(() => useVerdict('incognito'))

    await act(async () => {
      render(
        <FingerlyProvider apiKey="fly_pk_development_test" consent="granted">
          {identifier.element}
          {element}
        </FingerlyProvider>,
      )
    })

    expect(latest().matched).toBe(true)
    expect(latest().confidence).toBe('medium')
    expect(latest().reasons).toEqual(['firefox-private-origin-filesystem-refused'])
  })

  it('honours a confidence floor', async () => {
    const { latest, identifier, element } = mount(() => useVerdict('incognito', { min: 'high' }))

    await act(async () => {
      render(
        <FingerlyProvider apiKey="fly_pk_development_test" consent="granted">
          {identifier.element}
          {element}
        </FingerlyProvider>,
      )
    })

    // Fired, but at medium - which is not enough to act on when high is asked
    // for. The verdict is still readable; only `matched` is false.
    expect(latest().verdict?.value).toBe(true)
    expect(latest().matched).toBe(false)
  })

  it('defaults to medium, so one weak tell does not match', async () => {
    identifyMock.mockResolvedValue({ ...RESULT, verdicts: { tor: verdict(true, 'low') } })
    const { latest, identifier, element } = mount(() => useVerdict('tor'))

    await act(async () => {
      render(
        <FingerlyProvider apiKey="fly_pk_development_test" consent="granted">
          {identifier.element}
          {element}
        </FingerlyProvider>,
      )
    })

    expect(latest().verdict?.value).toBe(true)
    expect(latest().matched).toBe(false)
  })

  it('reports nothing rather than guessing before identification', () => {
    const { latest, element } = probe(() => useVerdict('automation'))
    render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>)

    expect(latest().verdict).toBeNull()
    expect(latest().confidence).toBeNull()
    expect(latest().matched).toBe(false)
    expect(latest().reasons).toEqual([])
  })
})

describe('suspend', () => {
  it('shows the fallback while collecting, then the answer', async () => {
    let finish!: (result: unknown) => void
    identifyMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )

    const Card = () => {
      const { verdicts } = useIdentify({ suspend: true })
      return <span>{verdicts?.automation.value ? 'automated' : 'human'}</span>
    }

    const { container } = await renderAsync(
      <FingerlyProvider apiKey="fly_pk_development_test" consent="granted">
        <Suspense fallback={<span>collecting</span>}>
          <Card />
        </Suspense>
      </FingerlyProvider>,
    )

    expect(container.textContent).toBe('collecting')

    await act(async () => {
      finish(RESULT)
    })

    expect(container.textContent).toBe('automated')
    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('suspends once, however many components read it', async () => {
    const Card = ({ name }: { name: 'incognito' | 'automation' }) => {
      useIdentify({ suspend: true })
      const { matched } = useVerdict(name)
      return <span>{`${name}:${matched} `}</span>
    }

    const { container } = await renderAsync(
      <FingerlyProvider apiKey="fly_pk_development_test" consent="granted">
        <Suspense fallback={<span>collecting</span>}>
          <Card name="incognito" />
          <Card name="automation" />
        </Suspense>
      </FingerlyProvider>,
    )

    // Both components suspended on the same promise, so they came back
    // together and cost one identification between them.
    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toBe('incognito:true automation:true ')
  })
})

describe('consent', () => {
  it('defaults to pending, so nothing identifies on mount until consent is granted', async () => {
    const identify = probe(() => useIdentify({ immediate: true }))
    const store = probe(() => useFingerly())

    await act(async () => {
      render(
        <FingerlyProvider apiKey="fly_pk_development_test">
          {identify.element}
          {store.element}
        </FingerlyProvider>,
      )
    })

    expect(identify.latest().consent).toBe('pending')
    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
    await act(async () => {
      await expect(identify.latest().identify()).rejects.toMatchObject({ code: 'consent_required' })
    })
    expect(identifyMock).not.toHaveBeenCalled()

    await act(async () => store.latest().setConsent('granted'))

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('waits for consent before identifying on mount, then identifies once', async () => {
    const identify = probe(() => useIdentify({ immediate: true }))
    const store = probe(() => useFingerly())

    await act(async () => {
      render(
        <FingerlyProvider apiKey="fly_pk_development_test" consent="pending">
          {identify.element}
          {store.element}
        </FingerlyProvider>,
      )
    })

    // Not even the client: nothing is loaded while the visitor has not answered.
    expect(loadMock).not.toHaveBeenCalled()
    expect(identify.latest().consent).toBe('pending')
    expect(identify.latest().error).toBeNull()

    await act(async () => store.latest().setConsent('granted'))

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(identify.latest().requestId).toBe('req_1')

    await act(async () => store.latest().setConsent('denied'))
    await act(async () => store.latest().setConsent('granted'))

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('follows the consent prop without rebuilding the store', async () => {
    const { latest, element } = probe(() => useIdentify({ immediate: true }))
    let root!: Root
    await act(async () => {
      root = render(<FingerlyProvider apiKey="fly_pk_development_test" consent="pending">{element}</FingerlyProvider>).root
    })
    expect(identifyMock).not.toHaveBeenCalled()

    await act(async () => root.render(<FingerlyProvider apiKey="fly_pk_development_test" consent="granted">{element}</FingerlyProvider>))

    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(latest().consent).toBe('granted')
    expect(latest().requestId).toBe('req_1')
  })

  it("follows the client's own setConsent", async () => {
    const identify = probe(() => useIdentify({ immediate: true }))
    const store = probe(() => useFingerly())
    await act(async () => {
      render(
        <FingerlyProvider apiKey="fly_pk_development_test" consent="denied">
          {identify.element}
          {store.element}
        </FingerlyProvider>,
      )
    })

    const client = await act(() => store.latest().client())
    await act(async () => client.setConsent('granted'))

    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(identify.latest().consent).toBe('granted')
  })

  it('surfaces a ConsentError from a manual identify through error', async () => {
    const { latest, element } = probe(() => useIdentify())
    render(<FingerlyProvider apiKey="fly_pk_development_test" consent="pending">{element}</FingerlyProvider>)

    await act(async () => {
      await expect(latest().identify()).rejects.toMatchObject({ code: 'consent_required' })
    })

    expect(latest().error).toBeInstanceOf(ConsentError)
    expect(identifyMock).not.toHaveBeenCalled()
  })

  it('renders the unidentified state instead of suspending until consent is granted', async () => {
    const Card = () => {
      const { verdicts } = useIdentify({ suspend: true })
      return <span>{verdicts ? 'identified' : 'waiting'}</span>
    }

    const { container } = await renderAsync(
      <FingerlyProvider apiKey="fly_pk_development_test" consent="pending">
        <Suspense fallback={<span>collecting</span>}>
          <Card />
        </Suspense>
      </FingerlyProvider>,
    )

    expect(container.textContent).toBe('waiting')
    expect(identifyMock).not.toHaveBeenCalled()
  })
})
