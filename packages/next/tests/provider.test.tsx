/**
 * The provider and the form field, rendered into a real tree.
 *
 * `@badele/web-js`'s `load()` is mocked - what is under test is where the
 * configuration comes from and what reaches the server, not whether a canvas
 * hashes. It is mocked by specifier, so the copy `@badele/react` imports is the
 * mocked one too.
 */

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const identifyMock = vi.fn()
const loadMock = vi.fn()

vi.mock('@badele/web-js', () => ({
  load: (...args: unknown[]) => loadMock(...args),
  TransportError: class TransportError extends Error {},
}))

const { BadeleProvider } = await import('../src/provider.js')
const { BadeleRequestId } = await import('../src/field.js')
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
  loadMock.mockResolvedValue({ identify: identifyMock })
})

afterEach(() => {
  for (const key of Object.keys(environment)) {
    if (!(key in original)) delete environment[key]
  }
  Object.assign(environment, original)
})

describe('BadeleProvider', () => {
  it('takes the key from NEXT_PUBLIC_BADELE_API_KEY', async () => {
    environment.NEXT_PUBLIC_BADELE_API_KEY = 'pk_from_env'

    await act(async () => {
      render(
        <BadeleProvider>
          <BadeleRequestId />
        </BadeleProvider>,
      )
    })

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'pk_from_env' })
  })

  it('takes the endpoint from the environment too', async () => {
    environment.NEXT_PUBLIC_BADELE_API_KEY = 'pk_from_env'
    environment.NEXT_PUBLIC_BADELE_ENDPOINT = 'https://badele.internal'

    await act(async () => {
      render(
        <BadeleProvider>
          <BadeleRequestId />
        </BadeleProvider>,
      )
    })

    expect(loadMock).toHaveBeenCalledWith({
      apiKey: 'pk_from_env',
      endpoint: 'https://badele.internal',
    })
  })

  it('lets a prop override the environment', async () => {
    environment.NEXT_PUBLIC_BADELE_API_KEY = 'pk_from_env'

    await act(async () => {
      render(
        <BadeleProvider apiKey="pk_from_prop">
          <BadeleRequestId />
        </BadeleProvider>,
      )
    })

    expect(loadMock).toHaveBeenCalledWith({ apiKey: 'pk_from_prop' })
  })

  it('says which variable to set when there is no key', () => {
    delete environment.NEXT_PUBLIC_BADELE_API_KEY
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    let thrown: unknown
    try {
      render(
        <BadeleProvider>
          <span />
        </BadeleProvider>,
      )
    } catch (error) {
      thrown = error
    }

    // The route that always works comes first, because the other one has a
    // condition on it that a reader cannot be expected to know.
    expect((thrown as Error).message).toMatch(/apiKey=\{process\.env/)
    expect((thrown as Error).message).toMatch(/NEXT_PUBLIC_BADELE_API_KEY/)
    expect((thrown as Error).message).toMatch(/transpilePackages/)
  })

  it('collects nothing on its own', () => {
    environment.NEXT_PUBLIC_BADELE_API_KEY = 'pk_from_env'

    render(
      <BadeleProvider>
        <span>page</span>
      </BadeleProvider>,
    )

    expect(loadMock).not.toHaveBeenCalled()
    expect(identifyMock).not.toHaveBeenCalled()
  })
})

describe('the environment read', () => {
  it('is a literal member expression, because Next replaces nothing else', async () => {
    // The regression this pins was found by running the demo, not by a test:
    // the first version read `const env = process.env` and then
    // `env.NEXT_PUBLIC_BADELE_API_KEY`, which Next cannot replace while
    // bundling. The server render found the key and hydration threw.
    //
    // Asserted against the source rather than the behaviour, because the
    // behaviour is a bundler's and no unit test has one.
    const { readFile } = await import('node:fs/promises')
    // Relative to the package root, which is where vitest runs from.
    const source = await readFile('src/provider.tsx', 'utf8')

    expect(source).toContain('process.env.NEXT_PUBLIC_BADELE_API_KEY')
    expect(source).toContain('process.env.NEXT_PUBLIC_BADELE_ENDPOINT')
    // No hoisting: `= process.env` followed by a property read is the shape
    // that survives the build and breaks in the browser.
    expect(source).not.toMatch(/=\s*process\.env\s*[;\n]/)
  })
})

describe('BadeleRequestId', () => {
  const provider = (children: ReactNode) => {
    environment.NEXT_PUBLIC_BADELE_API_KEY = 'pk_from_env'
    return <BadeleProvider>{children}</BadeleProvider>
  }

  it('renders the field empty and fills it once identified', async () => {
    const { container } = render(provider(<BadeleRequestId />))

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
              <BadeleRequestId />
            </form>
            <form>
              <BadeleRequestId />
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
    const { container } = render(provider(<BadeleRequestId name="risk_ref" />))
    await act(async () => undefined)

    expect(container.querySelector('input')?.getAttribute('name')).toBe('risk_ref')
  })

  it('can be told not to identify, for a form that does it at submit time', () => {
    render(provider(<BadeleRequestId immediate={false} />))

    expect(identifyMock).not.toHaveBeenCalled()
    expect(document.querySelector('input')).not.toBeNull()
  })
})
