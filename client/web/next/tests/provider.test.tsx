/**
 * The provider and the form field, rendered into a real tree.
 *
 * `@fingerly/web-js`'s `load()` is mocked - what is under test is where the
 * configuration comes from and what reaches the server, not whether a canvas
 * hashes. It is mocked by specifier, so the copy `@fingerly/react` imports is the
 * mocked one too.
 */

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const identifyMock = vi.fn()
const loadMock = vi.fn()

vi.mock('@fingerly/web-js', () => ({
  load: (...args: unknown[]) => loadMock(...args),
  TransportError: class TransportError extends Error {},
  ConsentError: class ConsentError extends Error {},
}))

/** The part of a client the store talks to, with consent that notifies as the real one does. */
function fakeClient(options: { consent?: string } = {}) {
  const listeners = new Set<(state: string) => void>()
  const client = {
    consent: options.consent ?? 'pending',
    identify: identifyMock,
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

const { FingerlyProvider } = await import('../src/provider.js')
const { FingerlyRequestId } = await import('../src/field.js')
const { REQUEST_ID_FIELD } = await import('../src/field-name.js')

const RESULT = {
  requestId: 'req_1',
  verdicts: { incognito: { value: false, confidence: 'low', reasons: [] } },
  report: { schema: 1, sources: {}, elapsed_ms: 12 },
}

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function render(ui: ReactNode): { container: HTMLElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)

  let root!: Root
  act(() => {
    root = createRoot(container)
    root.render(ui)
  })

  return { container, root }
}

const environment = process.env as Record<string, string | undefined>
const original = { ...environment }

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  identifyMock.mockResolvedValue(RESULT)
  loadMock.mockImplementation(async (options: { consent?: string }) => fakeClient(options))
})

afterEach(() => {
  for (const key of Object.keys(environment)) {
    if (!(key in original)) delete environment[key]
  }
  Object.assign(environment, original)
})

describe('FingerlyProvider', () => {
  it('takes the key from NEXT_PUBLIC_FINGERLY_API_KEY', async () => {
    environment.NEXT_PUBLIC_FINGERLY_API_KEY = 'pk_from_env'

    await act(async () => {
      render(
        <FingerlyProvider consent="granted">
          <FingerlyRequestId />
        </FingerlyProvider>,
      )
    })

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'pk_from_env', consent: 'granted' })
  })

  it('takes the endpoint from the environment too', async () => {
    environment.NEXT_PUBLIC_FINGERLY_API_KEY = 'pk_from_env'
    environment.NEXT_PUBLIC_FINGERLY_ENDPOINT = 'https://fingerly.internal'

    await act(async () => {
      render(
        <FingerlyProvider consent="granted">
          <FingerlyRequestId />
        </FingerlyProvider>,
      )
    })

    expect(loadMock).toHaveBeenCalledWith({
      apiKey: 'pk_from_env',
      endpoint: 'https://fingerly.internal',
      consent: 'granted',
    })
  })

  it('lets a prop override the environment', async () => {
    environment.NEXT_PUBLIC_FINGERLY_API_KEY = 'pk_from_env'

    await act(async () => {
      render(
        <FingerlyProvider apiKey="pk_from_prop" consent="granted">
          <FingerlyRequestId />
        </FingerlyProvider>,
      )
    })

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'pk_from_prop', consent: 'granted' })
  })

  it('says which variable to set when there is no key, and keeps the page up', async () => {
    delete environment.NEXT_PUBLIC_FINGERLY_API_KEY
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    loadMock.mockImplementation(async () => {
      throw new Error('An SDK key is required')
    })

    let container!: HTMLElement
    await act(async () => {
      container = render(
        <FingerlyProvider consent="granted">
          <span>page</span>
          <FingerlyRequestId />
        </FingerlyProvider>,
      ).container
    })

    // The page renders; a missing fraud-signal key must not take it down.
    expect(container.textContent).toBe('page')
    const message = logged.mock.calls.map((call) => String(call[0])).join('\n')
    // The route that always works comes first, because the other one has a
    // condition on it that a reader cannot be expected to know.
    expect(message).toMatch(/apiKey=\{process\.env/)
    expect(message).toMatch(/NEXT_PUBLIC_FINGERLY_API_KEY/)
    expect(message).toMatch(/transpilePackages/)
  })

  it('parses NEXT_PUBLIC_FINGERLY_ENDPOINTS once, so re-renders do not identify again', async () => {
    environment.NEXT_PUBLIC_FINGERLY_API_KEY = 'pk_from_env'
    environment.NEXT_PUBLIC_FINGERLY_ENDPOINTS = '["/k7x2qm4a"]'
    const tree = () => (
      <FingerlyProvider consent="granted">
        <FingerlyRequestId />
      </FingerlyProvider>
    )
    let root!: Root
    await act(async () => {
      root = render(tree()).root
    })
    for (let i = 0; i < 5; i++) await act(async () => root.render(tree()))

    expect(loadMock).toHaveBeenCalledTimes(1)
    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'pk_from_env', endpoints: ['/k7x2qm4a'], consent: 'granted' })
    expect(identifyMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a malformed NEXT_PUBLIC_FINGERLY_ENDPOINTS instead of throwing from render', async () => {
    environment.NEXT_PUBLIC_FINGERLY_API_KEY = 'pk_from_env'
    environment.NEXT_PUBLIC_FINGERLY_ENDPOINTS = 'not json'
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    let container!: HTMLElement
    await act(async () => {
      container = render(<FingerlyProvider consent="granted"><span>page</span></FingerlyProvider>).container
    })

    expect(container.textContent).toBe('page')
    expect(String(logged.mock.calls[0]?.[0])).toMatch(/NEXT_PUBLIC_FINGERLY_ENDPOINTS/)
  })

  it('collects nothing on its own', () => {
    environment.NEXT_PUBLIC_FINGERLY_API_KEY = 'pk_from_env'

    render(
      <FingerlyProvider>
        <span>page</span>
      </FingerlyProvider>,
    )

    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
  })
})

describe('the environment read', () => {
  it('is a literal member expression, because Next replaces nothing else', async () => {
    // The regression this pins was found by running the demo, not by a test:
    // the first version read `const env = process.env` and then
    // `env.NEXT_PUBLIC_FINGERLY_API_KEY`, which Next cannot replace while
    // bundling. The server render found the key and hydration threw.
    //
    // Asserted against the source rather than the behaviour, because the
    // behaviour is a bundler's and no unit test has one.
    const { readFile } = await import('node:fs/promises')
    // Relative to the package root, which is where vitest runs from.
    const source = await readFile('src/provider.tsx', 'utf8')

    expect(source).toContain('process.env.NEXT_PUBLIC_FINGERLY_API_KEY')
    expect(source).toContain('process.env.NEXT_PUBLIC_FINGERLY_ENDPOINT')
    // No hoisting: `= process.env` followed by a property read is the shape
    // that survives the build and breaks in the browser.
    expect(source).not.toMatch(/=\s*process\.env\s*[;\n]/)
  })
})

describe('FingerlyRequestId', () => {
  const provider = (children: ReactNode) => {
    environment.NEXT_PUBLIC_FINGERLY_API_KEY = 'pk_from_env'
    return <FingerlyProvider consent="granted">{children}</FingerlyProvider>
  }

  it('renders the field empty and fills it once identified', async () => {
    const { container } = render(provider(<FingerlyRequestId />))

    const input = container.querySelector('input')
    expect(input?.getAttribute('type')).toBe('hidden')
    expect(input?.getAttribute('name')).toBe(REQUEST_ID_FIELD)
    // Present and empty before the answer arrives, rather than absent: a
    // server can tell "submitted too early" from "no field at all".
    expect((input as HTMLInputElement).value).toBe('')

    await act(async () => undefined)

    expect((container.querySelector('input') as HTMLInputElement).value).toBe('req_1')
  })

  it('costs one identification however many fields a page has', async () => {
    await act(async () => {
      render(
        provider(
          <>
            <form>
              <FingerlyRequestId />
            </form>
            <form>
              <FingerlyRequestId />
            </form>
          </>,
        ),
      )
    })

    expect(identifyMock).toHaveBeenCalledTimes(1)
    const values = [...document.querySelectorAll('input')].map((input) => input.value)
    expect(values).toEqual(['req_1', 'req_1'])
  })

  it('takes a field name, for a form that already uses that one', async () => {
    const { container } = render(provider(<FingerlyRequestId name="risk_ref" />))
    await act(async () => undefined)

    expect(container.querySelector('input')?.getAttribute('name')).toBe('risk_ref')
  })

  it('defaults to pending, leaving the field empty and sending nothing', async () => {
    environment.NEXT_PUBLIC_FINGERLY_API_KEY = 'pk_from_env'
    const { container } = render(
      <FingerlyProvider>
        <FingerlyRequestId />
      </FingerlyProvider>,
    )
    await act(async () => undefined)

    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('')
  })

  it('waits for consent before filling the field, then identifies once it is granted', async () => {
    const { container, root } = render(
      <FingerlyProvider apiKey="fly_pk_development_test" consent="pending">
        <FingerlyRequestId />
      </FingerlyProvider>,
    )
    await act(async () => undefined)

    expect(loadMock).not.toHaveBeenCalled()
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('')

    await act(async () =>
      root.render(
        <FingerlyProvider apiKey="fly_pk_development_test" consent="granted">
          <FingerlyRequestId />
        </FingerlyProvider>,
      ),
    )

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'fly_pk_development_test', consent: 'granted' })
    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('req_1')
  })

  it('can be told not to identify, for a form that does it at submit time', () => {
    render(provider(<FingerlyRequestId immediate={false} />))

    expect(identifyMock).not.toHaveBeenCalled()
    expect(document.querySelector('input')).not.toBeNull()
  })
})
