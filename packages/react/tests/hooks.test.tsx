/**
 * The hooks, rendered into a real React tree.
 *
 * `@badele/web-js`'s `load()` is mocked, because what is under test here is the
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

vi.mock('@badele/web-js', () => ({
  load: (...args: unknown[]) => loadMock(...args),
  TransportError: class TransportError extends Error {},
}))

import type { UseVerdictReturn } from '../src/useVerdict.js'

const { BadeleProvider } = await import('../src/context.js')
const { useBadele } = await import('../src/useBadele.js')
const { useIdentify } = await import('../src/useIdentify.js')
const { useVerdict } = await import('../src/useVerdict.js')

const verdict = (value: boolean, confidence: 'low' | 'medium' | 'high', reasons: string[] = []) => ({
  value,
  confidence,
  reasons,
})

const RESULT = {
  requestId: 'req_1',
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
  loadMock.mockResolvedValue({ identify: identifyMock })
})

describe('BadeleProvider', () => {
  it('does not collect anything on mount', () => {
    const { element } = probe(() => useBadele())
    render(<BadeleProvider apiKey="pk_test">{element}</BadeleProvider>)

    // A provider that fingerprinted as it mounted would collect during the
    // first render of every app that installs it, whether or not the page
    // wanted an answer yet.
    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
  })

  it('passes the endpoint through, and omits it when unset', async () => {
    const { latest, element } = probe(() => useIdentify())
    render(
      <BadeleProvider apiKey="pk_test" endpoint="http://localhost:8099">
        {element}
      </BadeleProvider>,
    )

    await act(() => latest().identify())

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'pk_test', endpoint: 'http://localhost:8099' })
  })

  it('survives a parent re-render without rebuilding the store', async () => {
    // The props are an object literal, so a naive provider would build a new
    // store on every render of whatever is above it - discarding the
    // identification and collecting again.
    const { latest, element } = probe(() => useIdentify())
    const { root } = render(<BadeleProvider apiKey="pk_test">{element}</BadeleProvider>)

    await act(() => latest().identify())
    act(() => root.render(<BadeleProvider apiKey="pk_test">{element}</BadeleProvider>))
    await act(() => latest().identify())

    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(latest().requestId).toBe('req_1')
  })

  it('accepts a store built elsewhere, for one store per request', async () => {
    const { createBadeleStore } = await import('../src/store.js')
    const store = createBadeleStore({ apiKey: 'pk_request', submit: false })

    const { latest, element } = probe(() => useIdentify())
    render(<BadeleProvider store={store}>{element}</BadeleProvider>)

    await act(() => latest().identify())

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'pk_request' })
  })
})

describe('useBadele', () => {
  it('explains itself when the provider is missing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { element } = probe(() => useBadele())

    const { container } = render(<Boundary>{element}</Boundary>)

    expect(container.textContent).toMatch(/No <BadeleProvider> found/)
    expect(container.textContent).toMatch(/apiKey/)
  })
})

describe('useIdentify', () => {
  it('collects on mount when immediate is set, and exposes the result', async () => {
    const { latest, element } = probe(() => useIdentify({ immediate: true }))

    await act(async () => {
      render(<BadeleProvider apiKey="pk_test">{element}</BadeleProvider>)
    })

    expect(latest().isReady).toBe(true)
    expect(latest().isLoading).toBe(false)
    expect(latest().requestId).toBe('req_1')
    expect(latest().verdicts?.automation.value).toBe(true)
    expect(latest().error).toBeNull()
  })

  it('shares one identification across every component that asks', async () => {
    const a = probe(() => useIdentify({ immediate: true }))
    const b = probe(() => useIdentify({ immediate: true }))
    const c = probe(() => useIdentify({ immediate: true }))

    await act(async () => {
      render(
        <BadeleProvider apiKey="pk_test">
          {a.element}
          {b.element}
          {c.element}
        </BadeleProvider>,
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
          <BadeleProvider apiKey="pk_test">{element}</BadeleProvider>
        </StrictMode>,
      )
    })

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('reuses a finished identification rather than repeating it', async () => {
    const { latest, element } = probe(() => useIdentify())
    render(<BadeleProvider apiKey="pk_test">{element}</BadeleProvider>)

    await act(() => latest().identify())
    await act(() => latest().identify())

    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh one on refresh()', async () => {
    const { latest, element } = probe(() => useIdentify())
    render(<BadeleProvider apiKey="pk_test">{element}</BadeleProvider>)

    await act(() => latest().identify())
    await act(() => latest().refresh())

    expect(identifyMock).toHaveBeenCalledTimes(2)
  })

  it('reads a getter tag at submission time, not at render time', async () => {
    let orderId = 'order_1'
    const { latest, element } = probe(() => useIdentify({ tag: () => orderId }))
    render(<BadeleProvider apiKey="pk_test">{element}</BadeleProvider>)

    orderId = 'order_2'
    await act(() => latest().identify())

    expect(identifyMock).toHaveBeenCalledWith({ tag: 'order_2' })
  })

  it('records a failure without leaving an unhandled rejection', async () => {
    identifyMock.mockRejectedValue(new Error('collector exploded'))
    const { latest, element } = probe(() => useIdentify({ immediate: true }))

    await act(async () => {
      render(<BadeleProvider apiKey="pk_test">{element}</BadeleProvider>)
    })

    expect(latest().error?.message).toBe('collector exploded')
    expect(latest().isReady).toBe(true)
    expect(latest().isLoading).toBe(false)
  })

  it('retries after a failure rather than serving the rejection forever', async () => {
    identifyMock.mockRejectedValueOnce(new Error('collector exploded'))
    const { latest, element } = probe(() => useIdentify())
    render(<BadeleProvider apiKey="pk_test">{element}</BadeleProvider>)

    await act(async () => {
      await latest().identify().catch(() => undefined)
    })
    await act(() => latest().identify())

    expect(identifyMock).toHaveBeenCalledTimes(2)
    expect(latest().requestId).toBe('req_1')
  })

  it('leaves requestId null when submit is off, and still shares the run', async () => {
    identifyMock.mockResolvedValue({ ...RESULT, requestId: '' })

    const a = probe(() => useIdentify({ immediate: true }))
    const b = probe(() => useIdentify({ immediate: true }))

    await act(async () => {
      render(
        <BadeleProvider apiKey="pk_test" submit={false}>
          {a.element}
          {b.element}
        </BadeleProvider>,
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
        render(<BadeleProvider apiKey="pk_test">{element}</BadeleProvider>)
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

    it('is false before anything has been collected', () => {
      const { latest, element } = probe(() => useIdentify())
      render(<BadeleProvider apiKey="pk_test">{element}</BadeleProvider>)

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
        <BadeleProvider apiKey="pk_test">
          {identifier.element}
          {element}
        </BadeleProvider>,
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
        <BadeleProvider apiKey="pk_test">
          {identifier.element}
          {element}
        </BadeleProvider>,
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
        <BadeleProvider apiKey="pk_test">
          {identifier.element}
          {element}
        </BadeleProvider>,
      )
    })

    expect(latest().verdict?.value).toBe(true)
    expect(latest().matched).toBe(false)
  })

  it('reports nothing rather than guessing before identification', () => {
    const { latest, element } = probe(() => useVerdict('automation'))
    render(<BadeleProvider apiKey="pk_test">{element}</BadeleProvider>)

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
      <BadeleProvider apiKey="pk_test">
        <Suspense fallback={<span>collecting</span>}>
          <Card />
        </Suspense>
      </BadeleProvider>,
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
      <BadeleProvider apiKey="pk_test">
        <Suspense fallback={<span>collecting</span>}>
          <Card name="incognito" />
          <Card name="automation" />
        </Suspense>
      </BadeleProvider>,
    )

    // Both components suspended on the same promise, so they came back
    // together and cost one identification between them.
    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(container.textContent).toBe('incognito:true automation:true ')
  })
})
