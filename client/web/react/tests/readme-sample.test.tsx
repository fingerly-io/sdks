/**
 * The README's first sample, run as written, and a lint over every web README.
 *
 * The sample must take its decision from the backend, using the `requestId`
 * that `await identify()` resolved with. A value read from the render the
 * handler was created in (`isSuspicious`, `suspectLevel`) is still the one from
 * before the answer, so a sample that branched on it failed open on the first
 * submit. `load` and `fetch` are mocked; nothing is sent.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const identifyMock = vi.fn()
const loadMock = vi.fn()

vi.mock('@fingerly/web-js', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  load: (...args: unknown[]) => loadMock(...args),
}))

const { FingerlyProvider } = await import('../src/context.js')
const { useIdentify } = await import('../src/useIdentify.js')

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const HIGH = {
  requestId: 'req_1',
  visitorId: 'vis_1',
  visitorIsNew: false,
  visitorConfidence: 93,
  identifiable: true,
  duplicate: false,
  state: 'scored',
  suspectScore: 88,
  suspectLevel: 'high',
}

const WEB = join(import.meta.dirname, '..', '..')
const READMES = ['react', 'vue', 'svelte', 'angular', 'next', 'nuxt', 'web-js'] as const

/** Every fenced code block in a Markdown file, with the line it starts on. */
function codeBlocks(markdown: string): Array<{ line: number; code: string }> {
  const blocks: Array<{ line: number; code: string }> = []
  const lines = markdown.split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith('```')) {
      if (start < 0) start = i
      else {
        blocks.push({ line: start + 1, code: lines.slice(start + 1, i).join('\n') })
        start = -1
      }
    }
  }
  return blocks
}

describe('the README Checkout sample', () => {
  const fetchMock = vi.fn()
  const realFetch = globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    identifyMock.mockResolvedValue(HIGH)
    loadMock.mockImplementation(async () => ({
      consent: 'granted',
      identify: identifyMock,
      setConsent() {},
      onConsentChange: () => () => {},
    }))
    fetchMock.mockResolvedValue({ json: async () => ({ decision: 'challenge' }) })
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('forwards the fresh requestId and acts on the backend decision on the first submit', async () => {
    // react/README.md, "Identify", with <StepUp /> rendered as a marker.
    const StepUp = () => <p data-step-up="">step up</p>

    function Checkout({ orderId }: { orderId: string }) {
      const { identify, isLoading, error } = useIdentify({ tag: () => `checkout:${orderId}` })
      const [challenge, setChallenge] = useState(false)

      async function onSubmit() {
        const { requestId } = await identify()
        const response = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, requestId }),
        })
        const { decision } = await response.json()
        setChallenge(decision === 'challenge')
      }

      return (
        <>
          <button onClick={onSubmit} disabled={isLoading}>
            {isLoading ? 'Checking…' : 'Continue'}
          </button>
          {challenge && <StepUp />}
          {error && <p>{error.message}</p>}
        </>
      )
    }

    const readme = readFileSync(join(WEB, 'react', 'README.md'), 'utf8')
    expect(readme).toContain('const { requestId } = await identify()')
    expect(readme).toContain("setChallenge(decision === 'challenge')")

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <FingerlyProvider apiKey="fly_pk_development_test" consent="granted">
          <Checkout orderId="8412" />
        </FingerlyProvider>,
      )
    })

    await act(async () => {
      container.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(identifyMock).toHaveBeenCalledTimes(1)
    expect(identifyMock).toHaveBeenCalledWith({ tag: 'checkout:8412' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual({ orderId: '8412', requestId: 'req_1' })
    // The first submit already acts on the answer; nothing waits for a re-render.
    expect(container.querySelector('[data-step-up]')).not.toBeNull()

    act(() => root.unmount())
    container.remove()
  })
})

describe('the web READMEs', () => {
  it.each(READMES)('%s: no sample makes an access decision on the page-side level', (pkg) => {
    const readme = readFileSync(join(WEB, pkg, 'README.md'), 'utf8')
    const offending: string[] = []
    for (const { line, code } of codeBlocks(readme)) {
      code.split('\n').forEach((text, offset) => {
        if (
          /\bif\s*\(.*\b(isSuspicious|suspectLevel|suspectScore)\b/.test(text) ||
          /=\s*\(?\s*(this\.)?\w*\.?(suspectLevel|suspectScore)\b\s*(===|>=|>)/.test(text) ||
          /suspicious\s*=\s*suspectLevel/.test(text)
        ) {
          // event.suspect_level on a backend is the intended place.
          if (!/event\.suspect_level/.test(text)) offending.push(`${pkg}/README.md:${line + offset + 1}: ${text.trim()}`)
        }
      })
    }
    expect(offending).toEqual([])
  })

  it.each(READMES)('%s: links the server-side verification page next to the requestId sample', (pkg) => {
    const readme = readFileSync(join(WEB, pkg, 'README.md'), 'utf8')
    expect(readme).toContain('https://docs.fingerly.io/docs/server-side-verification')
    expect(readme).toMatch(/untrusted/)
    expect(readme).toContain('event.ip_network')
    expect(readme).toContain('event.occurred_at')
    expect(readme).toContain('event.tag !== expectedTag')
    // Another network is a step-up, not a refusal; an unscored or
    // unidentifiable event is refused.
    expect(readme).toContain("inNetwork(clientIp, event.ip_network)) return 'challenge'")
    expect(readme).toContain("if (!event.identifiable || event.suspect_score === null) return 'refuse'")
  })
})
