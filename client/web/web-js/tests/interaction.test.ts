// @vitest-environment happy-dom

import { SOURCE, type InteractionSignal } from '@fingerly/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InteractionObserver, INTERACTION_COUNTS } from '../src/sources/interaction.js'

// ADR 0029, Decision 3, schema 1: every key the source may send, in order.
// Written out here, not imported, so a key added or renamed in the source
// fails this test until the ADR and the server agree.
const DOCUMENTED_KEYS = [
  'span_s',
  'clicks_mouse',
  'clicks_touch',
  'clicks_pen',
  'clicks_keyboard',
  'clicks_without_move',
  'clicks_at_centre',
  'pointer_moves',
  'keydowns',
  'keys_fast',
  'inputs_typed',
  'inputs_pasted',
  'inputs_inserted',
  'inputs_replaced',
  'inputs_other',
  'pastes',
  'wheels',
  'wheels_round',
  'scrolls_unprompted',
  'untrusted',
  'trusted_unfocused',
  'viewport_steps',
  'overlays',
]

/** A clock the test moves by hand, in milliseconds. */
function manualClock() {
  let now = 0
  return {
    now: () => now,
    advance(ms: number) {
      now += ms
    },
  }
}

function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, 'isTrusted', { value: true })
  return event
}

function dispatch(event: Event, target: EventTarget = document.body): void {
  target.dispatchEvent(event)
}

const pointer = (type: string, init: PointerEventInit = {}) =>
  new PointerEvent(type, { bubbles: true, ...init })
const click = (pointerType: string, init: PointerEventInit = {}) =>
  new PointerEvent('click', { bubbles: true, pointerType, detail: 1, ...init })
const key = (keyName = 'a') => new KeyboardEvent('keydown', { bubbles: true, key: keyName })
const input = (inputType?: string) =>
  inputType === undefined
    ? new Event('input', { bubbles: true })
    : new InputEvent('input', { bubbles: true, inputType })
const wheel = (init: WheelEventInit) => new WheelEvent('wheel', { bubbles: true, ...init })

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

let clock: ReturnType<typeof manualClock>
let observer: InteractionObserver

beforeEach(() => {
  setViewport(1280, 800)
  clock = manualClock()
  observer = new InteractionObserver(clock.now)
  expect(observer.start()).toBe(true)
})

afterEach(() => {
  observer.stop()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the interaction observer: what each count means', () => {
  it('counts clicks by pointer type, and a click with no pointer and detail 0 as keyboard', () => {
    dispatch(click('mouse'))
    dispatch(click('mouse'))
    dispatch(click('touch'))
    dispatch(click('pen'))
    dispatch(click('', { detail: 0 }))
    // A browser that sends click as a plain MouseEvent: keyboard by detail,
    // otherwise the pointer of the press before it.
    dispatch(new MouseEvent('click', { bubbles: true, detail: 0 }))
    dispatch(pointer('pointerdown', { pointerType: 'touch' }))
    dispatch(new MouseEvent('click', { bubbles: true, detail: 1 }))
    dispatch(new MouseEvent('click', { bubbles: true, detail: 1 }))

    const counts = observer.take()
    expect(counts.clicks_mouse).toBe(3)
    expect(counts.clicks_touch).toBe(2)
    expect(counts.clicks_pen).toBe(1)
    expect(counts.clicks_keyboard).toBe(2)
  })

  it('counts a mouse click as without move when no pointermove came in the 500 ms before its press', () => {
    // A move, then a press 100 ms later: a human click.
    dispatch(pointer('pointermove', { pointerType: 'mouse' }))
    clock.advance(100)
    dispatch(pointer('pointerdown', { pointerType: 'mouse' }))
    clock.advance(900) // a long press; the move before the press is what counts
    dispatch(click('mouse'))

    // A press 600 ms after the last move: a teleport.
    clock.advance(600)
    dispatch(pointer('pointerdown', { pointerType: 'mouse' }))
    dispatch(click('mouse'))

    // A click with no press at all, long after the last move.
    clock.advance(2000)
    dispatch(click('mouse'))

    // Exactly 500 ms is still "in the 500 ms before".
    dispatch(pointer('pointermove', { pointerType: 'mouse' }))
    clock.advance(500)
    dispatch(pointer('pointerdown', { pointerType: 'mouse' }))
    dispatch(click('mouse'))

    const counts = observer.take()
    expect(counts.clicks_mouse).toBe(4)
    expect(counts.clicks_without_move).toBe(2)
    expect(counts.pointer_moves).toBe(2)
  })

  it('never counts touch, pen or keyboard clicks as without move or at centre', () => {
    const button = document.createElement('button')
    document.body.append(button)
    button.getBoundingClientRect = () => new DOMRect(0, 0, 100, 40)

    dispatch(pointer('pointerdown', { pointerType: 'touch' }), button)
    dispatch(click('touch', { clientX: 50, clientY: 20 }), button)
    dispatch(click('pen', { clientX: 50, clientY: 20 }), button)
    dispatch(click('', { detail: 0, clientX: 50, clientY: 20 }), button)

    const counts = observer.take()
    expect(counts.clicks_without_move).toBe(0)
    expect(counts.clicks_at_centre).toBe(0)
  })

  it('counts mouse clicks within 2 px of the target centre', () => {
    const button = document.createElement('button')
    document.body.append(button)
    button.getBoundingClientRect = () => new DOMRect(10, 20, 100, 40) // centre 60, 40

    dispatch(click('mouse', { clientX: 60, clientY: 40 }), button)
    dispatch(click('mouse', { clientX: 62, clientY: 38 }), button)
    dispatch(click('mouse', { clientX: 63, clientY: 40 }), button)
    dispatch(click('mouse', { clientX: 60, clientY: 43 }), button)

    expect(observer.take().clicks_at_centre).toBe(2)
  })

  it('counts keydowns, and those under 15 ms after the previous one as fast', () => {
    dispatch(key())
    clock.advance(10)
    dispatch(key()) // fast
    clock.advance(100)
    dispatch(key())
    clock.advance(14)
    dispatch(key()) // fast
    clock.advance(15)
    dispatch(key()) // 15 ms is not under 15

    const counts = observer.take()
    expect(counts.keydowns).toBe(5)
    expect(counts.keys_fast).toBe(2)
  })

  it('sorts input events by inputType, typed only with a keydown in the previous 50 ms', () => {
    const field = document.createElement('input')
    document.body.append(field)

    dispatch(key(), field)
    clock.advance(5)
    dispatch(input('insertText'), field) // typed
    clock.advance(45)
    dispatch(input('insertText'), field) // 50 ms after the key: still typed
    clock.advance(1)
    dispatch(input('insertText'), field) // inserted
    clock.advance(1000)
    dispatch(input('insertText'), field) // inserted
    dispatch(input('insertFromPaste'), field)
    dispatch(input('insertReplacementText'), field)
    dispatch(input('deleteContentBackward'), field)
    dispatch(input('insertCompositionText'), field)
    dispatch(input(), field) // a plain Event, as a select or a checkbox sends

    const counts = observer.take()
    expect(counts.inputs_typed).toBe(2)
    expect(counts.inputs_inserted).toBe(2)
    expect(counts.inputs_pasted).toBe(1)
    expect(counts.inputs_replaced).toBe(1)
    expect(counts.inputs_other).toBe(3)
  })

  it('counts paste events without reading the clipboard', () => {
    const event = new Event('paste', { bubbles: true })
    Object.defineProperty(event, 'clipboardData', {
      get() {
        throw new Error('the clipboard must not be read')
      },
    })
    dispatch(event)
    dispatch(new Event('paste', { bubbles: true }))

    expect(observer.take().pastes).toBe(2)
  })

  it('counts wheel events, and those in pixels whose deltas are whole nonzero multiples of 100 as round', () => {
    dispatch(wheel({ deltaY: 100 })) // round
    dispatch(wheel({ deltaY: -200 })) // round
    dispatch(wheel({ deltaX: 300, deltaY: 0 })) // round
    dispatch(wheel({ deltaY: 53 }))
    dispatch(wheel({ deltaX: 100, deltaY: 3 }))
    dispatch(wheel({ deltaY: 0 }))
    dispatch(wheel({ deltaY: 100.5 }))
    dispatch(wheel({ deltaY: 100, deltaMode: 1 })) // lines, not pixels

    const counts = observer.take()
    expect(counts.wheels).toBe(8)
    expect(counts.wheels_round).toBe(3)
  })

  it('counts scrolls with no wheel, touch or scroll key in the previous 300 ms as unprompted', () => {
    const pane = document.createElement('div')
    document.body.append(pane)
    // Scroll does not bubble; the capture listener on the document still sees it.
    const scroll = () => dispatch(new Event('scroll'), pane)

    scroll() // nothing before it
    dispatch(wheel({ deltaY: 40 }))
    clock.advance(100)
    scroll() // prompted by the wheel
    clock.advance(301)
    scroll() // the wheel is too long ago
    dispatch(key('PageDown'))
    scroll() // prompted by a scroll key
    clock.advance(1000)
    dispatch(key('a'))
    scroll() // a letter is not a scroll key
    clock.advance(1000)
    dispatch(new Event('touchmove', { bubbles: true }))
    scroll() // prompted by touch
    clock.advance(1000)
    dispatch(pointer('pointerdown', { pointerType: 'touch' }))
    scroll() // prompted by a touch pointer
    clock.advance(1000)
    dispatch(new Event('scroll'), document) // the document's own scroll

    expect(observer.take().scrolls_unprompted).toBe(4)
  })

  it('counts click, key and input events that are not trusted (dispatched by script)', () => {
    dispatch(click('mouse'))
    dispatch(key())
    dispatch(input('insertText'))
    // Not in the untrusted count: pointer moves, wheels, pastes, scrolls.
    dispatch(pointer('pointermove'))
    dispatch(wheel({ deltaY: 10 }))
    dispatch(new Event('paste', { bubbles: true }))
    dispatch(new Event('scroll'))
    // Trusted ones are not counted.
    dispatch(trusted(click('mouse')))
    dispatch(trusted(key()))
    dispatch(trusted(input('insertText')))

    expect(observer.take().untrusted).toBe(3)
  })

  it('counts trusted clicks and keys while the document has no focus or is hidden', () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    dispatch(trusted(click('mouse')))
    dispatch(trusted(key()))
    dispatch(click('mouse')) // untrusted: counted there, not here
    dispatch(trusted(input('insertText'))) // inputs are not part of this count

    hasFocus.mockReturnValue(true)
    dispatch(trusted(click('mouse')))
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    dispatch(trusted(key()))
    visibility.mockReturnValue('visible')
    dispatch(trusted(key()))

    const counts = observer.take()
    expect(counts.trusted_unfocused).toBe(3)
    expect(counts.untrusted).toBe(1)
  })

  it('counts innerHeight drops of 24 to 64 px with the width unchanged', () => {
    const resize = (width: number, height: number) => {
      setViewport(width, height)
      window.dispatchEvent(new Event('resize'))
    }
    resize(1280, 760) // 40: a step
    resize(1280, 736) // 24: a step
    resize(1280, 672) // 64: a step
    resize(1280, 650) // 22: too small
    resize(1280, 580) // 70: too large
    resize(1280, 620) // grew
    resize(1100, 580) // 40, but the width changed

    expect(observer.take().viewport_steps).toBe(3)
  })

  it('counts added fixed or absolute elements at z-index 2147483000 or more with pointer-events none', async () => {
    const add = (style: string, parent: Element = document.body) => {
      const element = document.createElement('div')
      element.setAttribute('style', style)
      parent.append(element)
      return element
    }
    add('position: fixed; z-index: 2147483647; pointer-events: none')
    add('position: absolute; z-index: 2147483000; pointer-events: none')
    add('position: fixed; z-index: 2147482999; pointer-events: none')
    add('position: fixed; z-index: 2147483647; pointer-events: auto')
    add('position: relative; z-index: 2147483647; pointer-events: none')
    add('position: fixed; z-index: auto; pointer-events: none')
    // Only elements added directly are read, not the descendants they bring.
    const wrapper = document.createElement('div')
    wrapper.innerHTML =
      '<div style="position: fixed; z-index: 2147483647; pointer-events: none"></div>'
    document.body.append(wrapper)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(observer.take().overlays).toBe(2)
  })

  it('reads at most 32 added elements per mutation batch', async () => {
    for (let i = 0; i < 40; i++) {
      const element = document.createElement('div')
      element.setAttribute('style', 'position: fixed; z-index: 2147483647; pointer-events: none')
      document.body.append(element)
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(observer.take().overlays).toBe(32)
  })

  it('works on a touch-only page', () => {
    dispatch(pointer('pointerdown', { pointerType: 'touch' }))
    dispatch(click('touch'))
    dispatch(pointer('pointerdown', { pointerType: 'touch' }))
    dispatch(click('touch'))

    const counts = observer.take()
    expect(counts).toMatchObject({ clicks_touch: 2, clicks_mouse: 0, clicks_without_move: 0 })
  })

  it('works on a keyboard-only page', () => {
    for (const name of ['Tab', 'Tab', 'Enter']) {
      dispatch(key(name))
      clock.advance(120)
    }
    dispatch(click('', { detail: 0 }))
    dispatch(input('insertText'))

    const counts = observer.take()
    expect(counts).toMatchObject({
      keydowns: 3,
      keys_fast: 0,
      clicks_keyboard: 1,
      clicks_mouse: 0,
      clicks_without_move: 0,
    })
  })
})

describe('the interaction observer: span, caps and reads', () => {
  it('caps every count at 10,000', () => {
    for (let i = 0; i < 10_050; i++) dispatch(key())
    const counts = observer.take()
    expect(counts.keydowns).toBe(10_000)
    expect(counts.keys_fast).toBe(10_000)
    expect(counts.untrusted).toBe(10_000)
  })

  it('reports whole seconds since the start or the previous read, and starts the counts again at each read', () => {
    dispatch(click('mouse'))
    clock.advance(12_400)
    const first = observer.take()
    expect(first.span_s).toBe(12)
    expect(first.clicks_mouse).toBe(1)

    clock.advance(2_600)
    const second = observer.take()
    expect(second.span_s).toBe(3)
    for (const name of INTERACTION_COUNTS) expect(second[name], name).toBe(0)
  })

  it('reports only the documented integer counts, and nothing else', () => {
    const field = document.createElement('input')
    field.value = 'secret value'
    document.body.append(field)
    dispatch(pointer('pointermove', { clientX: 321, clientY: 654 }))
    dispatch(click('mouse', { clientX: 321, clientY: 654 }), field)
    dispatch(key('q'), field)
    dispatch(input('insertText'), field)
    clock.advance(4_000)

    const counts = observer.take()
    expect(Object.keys(counts)).toEqual(DOCUMENTED_KEYS)
    for (const [name, value] of Object.entries(counts)) {
      expect(Number.isInteger(value), name).toBe(true)
      expect(value, name).toBeGreaterThanOrEqual(0)
    }
    const wire = JSON.stringify(counts)
    for (const leak of ['secret', '321', '654', '"q"', 'INPUT', 'http']) {
      expect(wire).not.toContain(leak)
    }
  })

  it('lets no exception escape a listener', () => {
    const errors: unknown[] = []
    const onError = (event: ErrorEvent) => errors.push(event.error)
    window.addEventListener('error', onError)
    try {
      const target = document.createElement('button')
      target.getBoundingClientRect = () => {
        throw new Error('hostile page')
      }
      document.body.append(target)
      vi.spyOn(document, 'hasFocus').mockImplementation(() => {
        throw new Error('hostile page')
      })

      expect(() => dispatch(trusted(click('mouse')), target)).not.toThrow()
      expect(() => dispatch(trusted(key()), target)).not.toThrow()
      expect(() => dispatch(new WheelEvent('wheel', { bubbles: true, deltaY: Number.NaN }))).not.toThrow()

      const counts = observer.take()
      expect(counts.clicks_mouse).toBe(1)
      expect(counts.keydowns).toBe(1)
      expect(counts.wheels).toBe(1)
      expect(errors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  it('removes every listener and observer it added when stopped, and counts nothing after', () => {
    observer.stop()
    const added = vi.spyOn(document, 'addEventListener')
    const removed = vi.spyOn(document, 'removeEventListener')
    const addedOnWindow = vi.spyOn(window, 'addEventListener')
    const removedOnWindow = vi.spyOn(window, 'removeEventListener')

    const fresh = new InteractionObserver(clock.now)
    fresh.start()
    fresh.stop()

    expect(added.mock.calls.length).toBeGreaterThan(0)
    expect(removed.mock.calls).toEqual(added.mock.calls)
    expect(removedOnWindow.mock.calls).toEqual(addedOnWindow.mock.calls)
    for (const call of added.mock.calls) expect(call[2]).toEqual({ capture: true, passive: true })

    dispatch(click('mouse'))
    expect(fresh.running).toBe(false)
    fresh.start()
    expect(fresh.take().clicks_mouse).toBe(0)
    fresh.stop()
  })

  it('lets nothing seen before a stop shape what it counts after a restart', () => {
    // A move, then consent withdrawn and granted again 100 ms later: the
    // move belongs to the withdrawn span, so the first click after is a
    // click without move, and a key before the stop makes no typed input.
    dispatch(pointer('pointermove', { pointerType: 'mouse' }))
    dispatch(key('a'))
    observer.stop()
    clock.advance(10)
    observer.start()
    dispatch(pointer('pointerdown', { pointerType: 'mouse' }))
    dispatch(click('mouse'))
    dispatch(input('insertText'))

    const counts = observer.take()
    expect(counts.clicks_without_move).toBe(1)
    expect(counts.keys_fast).toBe(0)
    expect(counts.inputs_typed).toBe(0)
    expect(counts.inputs_inserted).toBe(1)
  })
})

describe('the interaction source in the SDK', () => {
  async function freshSdk() {
    vi.resetModules()
    return import('../src/index.js')
  }

  const onlyInteraction = { filter: (source: { id: string }) => source.id === SOURCE.interaction }

  beforeEach(() => {
    // The page-level tests above run their own observer; this block uses the SDK's.
    observer.stop()
  })

  it('is in the catalogue as a collect-stage, opt-in, non-critical source', async () => {
    const { browserSources } = await freshSdk()
    const source = browserSources.find((entry) => entry.id === SOURCE.interaction)
    expect(source).toMatchObject({ stage: 'collect', optIn: 'agent-interaction' })
    expect(source?.identityCritical).toBeUndefined()
    expect(source?.timeoutMs).toBeLessThanOrEqual(50)
  })

  it('sends nothing and observes nothing when the page did not opt in', async () => {
    const added = vi.spyOn(document, 'addEventListener')
    const { load } = await freshSdk()
    const fingerly = await load({
      apiKey: 'fly_pk_development_test',
      consent: 'granted',
      schedule: onlyInteraction,
    })
    dispatch(click('mouse'))

    const report = await fingerly.collect()
    expect(report.sources).not.toHaveProperty(SOURCE.interaction)
    expect(added.mock.calls.some(([type]) => type === 'pointermove')).toBe(false)
  })

  it('observes nothing while consent is pending, and starts once it is granted', async () => {
    const added = vi.spyOn(document, 'addEventListener')
    const { ConsentError, load } = await freshSdk()
    const fingerly = await load({
      apiKey: 'fly_pk_development_test',
      consent: 'pending',
      agentDetection: 'interaction',
      schedule: onlyInteraction,
    })
    dispatch(click('mouse'))
    expect(added).not.toHaveBeenCalled()
    await expect(fingerly.collect()).rejects.toBeInstanceOf(ConsentError)

    fingerly.setConsent('granted')
    expect(added.mock.calls.some(([type]) => type === 'pointermove')).toBe(true)
    dispatch(click('mouse'))
    dispatch(click('mouse'))

    const report = await fingerly.collect()
    expect(report.sources.interaction?.status).toBe('ok')
    const value = report.sources.interaction?.value as InteractionSignal
    expect(Object.keys(value)).toEqual(DOCUMENTED_KEYS)
    expect(value.clicks_mouse).toBe(2)

    // Read once: the next report starts from zero.
    const next = (await fingerly.collect()).sources.interaction?.value as InteractionSignal
    expect(next.clicks_mouse).toBe(0)
  })

  it('stops and drops its counts when consent is withdrawn, and starts afresh when granted again', async () => {
    const removed = vi.spyOn(document, 'removeEventListener')
    const { load } = await freshSdk()
    const fingerly = await load({
      apiKey: 'fly_pk_development_test',
      consent: 'granted',
      agentDetection: 'interaction',
      schedule: onlyInteraction,
    })
    dispatch(click('mouse'))

    fingerly.setConsent('denied')
    expect(removed.mock.calls.some(([type]) => type === 'pointermove')).toBe(true)
    dispatch(click('mouse'))

    fingerly.setConsent('granted')
    dispatch(click('touch'))
    const value = (await fingerly.collect()).sources.interaction?.value as InteractionSignal
    expect(value).toMatchObject({ clicks_mouse: 0, clicks_touch: 1 })
  })

  it('is left out of the report when the caller replaces the sources', async () => {
    const { browserSources, load } = await freshSdk()
    const fingerly = await load({
      apiKey: 'fly_pk_development_test',
      consent: 'granted',
      agentDetection: 'interaction',
      sources: browserSources.filter((source) => source.id === SOURCE.interaction),
    })
    dispatch(click('mouse'))

    const report = await fingerly.collect()
    expect(report.sources).not.toHaveProperty(SOURCE.interaction)
  })

  it('submits only the documented counts in the identify() report', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)))
        return new Response('{"request_id":"req_1","visitor_id":"vis_1","identifiable":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const { load } = await freshSdk()
    const fingerly = await load({
      apiKey: 'fly_pk_development_test',
      consent: 'granted',
      agentDetection: 'interaction',
      schedule: onlyInteraction,
    })
    dispatch(pointer('pointermove', { pointerType: 'mouse', clientX: 400, clientY: 300 }))
    dispatch(click('mouse', { clientX: 400, clientY: 300 }))
    dispatch(key('x'))

    await fingerly.identify()
    const report = bodies.find((body) => body.op === undefined) as {
      signals: { sources: Record<string, { status: string; value: Record<string, unknown> }> }
    }
    const sent = report.signals.sources.interaction
    expect(sent?.status).toBe('ok')
    expect(Object.keys(sent?.value ?? {})).toEqual(DOCUMENTED_KEYS)
    expect(sent?.value).toMatchObject({ clicks_mouse: 1, pointer_moves: 1, keydowns: 1, untrusted: 2 })
    expect(Object.values(sent?.value ?? {}).every((entry) => Number.isInteger(entry))).toBe(true)
  })

  it('refuses an agentDetection mode it does not know', async () => {
    const { load } = await freshSdk()
    await expect(
      load({
        apiKey: 'fly_pk_development_test',
        agentDetection: 'all' as unknown as 'interaction',
      }),
    ).rejects.toBeInstanceOf(TypeError)
  })
})
