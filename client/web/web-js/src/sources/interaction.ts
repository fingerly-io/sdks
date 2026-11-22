/**
 * Opt-in interaction observer (`agentDetection: 'interaction'`, ADR 0029).
 *
 * An assistant that drives the visitor's own browser sends that browser's user
 * agent from the visitor's address, so nothing in the device says it is there.
 * How the page is operated can: clicks that arrive with no pointer movement
 * before them, text that appears with no key pressed, events the page did not
 * get from the user, a debugger infobar shrinking the viewport. Every one of
 * those has an ordinary human explanation too (touch, keyboard-only use,
 * autofill, dictation, a screen reader), so the SDK only counts, and the
 * server decides from several counts together.
 *
 * The observer starts once collection is permitted on a page that asked for
 * it ([startInteractionObserver]), and the `interaction` source hands its
 * counts to `identify()` (or `collect()`), which starts them again from zero.
 *
 * What it keeps in memory is only what the counts need: the time of the last
 * pointer move, key press, and wheel, touch or scroll key, the pointer type and
 * movement flag of the pending press, the last window size, and the counts.
 * Nothing it keeps is sent except the counts and the length of the span:
 * never a coordinate, a key, a field value, page text, an element identifier,
 * a URL or a per-event time.
 *
 * Every listener is capture phase and passive, so it never delays scrolling or
 * changes what the page sees, and none lets an exception escape.
 */

import {
  INTERACTION_CAP,
  SOURCE,
  UnsupportedSignal,
  type InteractionSignal,
  type Source,
} from '@fingerly/core'

/** A mouse click is a teleport when no move came this long before the press. */
const MOVE_BEFORE_PRESS_MS = 500
/** How far from the target's centre a click may land and still count as "at" it. */
const CENTRE_PX = 2
/** A key press this soon after the previous one is machine speed. */
const FAST_KEY_MS = 15
/** An `insertText` this soon after a key press was typed. */
const TYPED_AFTER_KEY_MS = 50
/** A scroll this soon after a wheel, touch or scroll key was asked for. */
const SCROLL_PROMPT_MS = 300
/** A debugger or automation infobar takes this much height and no width. */
const VIEWPORT_STEP_MIN_PX = 24
const VIEWPORT_STEP_MAX_PX = 64
/** The z-index assistants draw their full-page overlays at, and above. */
const OVERLAY_MIN_Z = 2_147_483_000
/** Added elements whose computed style is read per batch; the rest are skipped. */
const OVERLAY_CHECKS_PER_BATCH = 32

/** Keys whose default action scrolls the page. Compared, never stored. */
const SCROLL_KEYS: ReadonlySet<string> = new Set([
  ' ',
  'Spacebar',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

type Count = Exclude<keyof InteractionSignal, 'span_s'>

/** Every count, in the order ADR 0029 lists them and the report carries them. */
export const INTERACTION_COUNTS: readonly Count[] = [
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

function zeroCounts(): Record<Count, number> {
  const counts = {} as Record<Count, number>
  for (const name of INTERACTION_COUNTS) counts[name] = 0
  return counts
}

function monotonicNow(): number {
  return typeof performance === 'object' && performance !== null && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

/** A number of pixels as the delta of a wheel step, or 0 when it is not one. */
function deltaOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

type PointerKind = 'mouse' | 'touch' | 'pen'

function pointerKind(value: unknown): PointerKind | undefined {
  return value === 'mouse' || value === 'touch' || value === 'pen' ? value : undefined
}

/**
 * One page's interaction counts. Exported for tests; the SDK runs one per page
 * through [[startInteractionObserver]].
 */
export class InteractionObserver {
  readonly #now: () => number
  #counts = zeroCounts()
  #running = false
  #spanStart = 0
  #teardown: (() => void)[] = []

  // In memory only, and only what the counts need.
  #lastMove = Number.NEGATIVE_INFINITY
  #lastKey = Number.NEGATIVE_INFINITY
  #lastScrollPrompt = Number.NEGATIVE_INFINITY
  /** The pointer type of the press the next click belongs to. */
  #pressKind: PointerKind | undefined
  /** Whether that press, if a mouse press, came with no move before it. */
  #pressWithoutMove: boolean | undefined
  #width: number | undefined
  #height: number | undefined

  #pendingOverlays: Element[] = []
  #overlayTimer: ReturnType<typeof setTimeout> | undefined
  #checked = new WeakSet<Node>()

  constructor(now: () => number = monotonicNow) {
    this.#now = now
  }

  get running(): boolean {
    return this.#running
  }

  /**
   * Adds the listeners and starts a span. Returns whether the page has a
   * document to observe. Calling it while running does nothing.
   */
  start(): boolean {
    if (this.#running) return true
    if (typeof document !== 'object' || document === null || typeof window !== 'object') return false
    try {
      this.#listen()
    } catch {
      this.stop()
      return false
    }
    this.#counts = zeroCounts()
    this.#spanStart = this.#now()
    this.#running = true
    return true
  }

  /** Removes every listener and drops the counts. */
  stop(): void {
    this.#running = false
    for (const remove of this.#teardown.splice(0)) {
      try {
        remove()
      } catch {
        /* a page that broke removeEventListener keeps nothing of ours running anyway */
      }
    }
    if (this.#overlayTimer !== undefined) clearTimeout(this.#overlayTimer)
    this.#overlayTimer = undefined
    this.#pendingOverlays = []
    this.#counts = zeroCounts()
    // Nothing seen before a withdrawal may shape what is counted after it.
    this.#lastMove = Number.NEGATIVE_INFINITY
    this.#lastKey = Number.NEGATIVE_INFINITY
    this.#lastScrollPrompt = Number.NEGATIVE_INFINITY
    this.#pressKind = undefined
    this.#pressWithoutMove = undefined
    this.#width = undefined
    this.#height = undefined
  }

  /**
   * The counts since the start or the previous read, and the seconds they
   * cover. Starts the counts again from zero.
   */
  take(): InteractionSignal {
    this.#checkOverlays()
    const now = this.#now()
    const signal = { span_s: Math.max(0, Math.round((now - this.#spanStart) / 1000)) } as InteractionSignal
    for (const name of INTERACTION_COUNTS) signal[name] = this.#counts[name]
    this.#counts = zeroCounts()
    this.#spanStart = now
    return signal
  }

  #add(name: Count): void {
    if (this.#counts[name] < INTERACTION_CAP) this.#counts[name] += 1
  }

  #on(target: EventTarget, type: string, handler: (event: Event) => void): void {
    const listener = (event: Event): void => {
      try {
        handler(event)
      } catch {
        /* an observation must never break the page */
      }
    }
    const options: AddEventListenerOptions = { capture: true, passive: true }
    target.addEventListener(type, listener, options)
    this.#teardown.push(() => target.removeEventListener(type, listener, options))
  }

  #listen(): void {
    const doc = document
    const win = window

    this.#on(doc, 'pointermove', (event) => this.#pointerMove(event as PointerEvent))
    this.#on(doc, 'pointerdown', (event) => this.#pointerDown(event as PointerEvent))
    this.#on(doc, 'click', (event) => this.#click(event as MouseEvent))
    this.#on(doc, 'keydown', (event) => this.#keyDown(event as KeyboardEvent))
    this.#on(doc, 'input', (event) => this.#input(event as InputEvent))
    this.#on(doc, 'paste', () => this.#add('pastes'))
    this.#on(doc, 'wheel', (event) => this.#wheel(event as WheelEvent))
    for (const type of ['touchstart', 'touchmove', 'touchend']) {
      this.#on(doc, type, () => {
        this.#lastScrollPrompt = this.#now()
      })
    }
    // Scroll does not bubble from an element, but a capture listener on the
    // document sees every one, the document's own included.
    this.#on(doc, 'scroll', () => this.#scroll())

    this.#width = win.innerWidth
    this.#height = win.innerHeight
    this.#on(win, 'resize', () => this.#resize())
    const viewport = (win as { visualViewport?: EventTarget | null }).visualViewport
    if (viewport && typeof viewport.addEventListener === 'function') {
      this.#on(viewport, 'resize', () => this.#resize())
    }

    this.#observeOverlays()
  }

  #pointerMove(event: PointerEvent): void {
    this.#add('pointer_moves')
    const now = this.#now()
    this.#lastMove = now
    if (event.pointerType === 'touch') this.#lastScrollPrompt = now
  }

  #pointerDown(event: PointerEvent): void {
    const kind = pointerKind(event.pointerType)
    const now = this.#now()
    this.#pressKind = kind
    this.#pressWithoutMove = kind === 'mouse' ? now - this.#lastMove > MOVE_BEFORE_PRESS_MS : undefined
    if (kind === 'touch') this.#lastScrollPrompt = now
  }

  #trust(event: Event): boolean {
    if (event.isTrusted === true) return true
    this.#add('untrusted')
    return false
  }

  #unfocused(): boolean {
    try {
      return document.visibilityState === 'hidden' || !document.hasFocus()
    } catch {
      return false
    }
  }

  #click(event: MouseEvent): void {
    if (this.#trust(event) && this.#unfocused()) this.#add('trusted_unfocused')

    const kind = this.#clickKind(event)
    if (kind === 'keyboard') {
      this.#add('clicks_keyboard')
    } else {
      this.#add(kind === 'mouse' ? 'clicks_mouse' : kind === 'touch' ? 'clicks_touch' : 'clicks_pen')
      if (kind === 'mouse') {
        const withoutMove =
          this.#pressWithoutMove ?? this.#now() - this.#lastMove > MOVE_BEFORE_PRESS_MS
        if (withoutMove) this.#add('clicks_without_move')
        if (atCentre(event)) this.#add('clicks_at_centre')
      }
    }
    this.#pressKind = undefined
    this.#pressWithoutMove = undefined
  }

  /**
   * The pointer that made a click. A `click` is a `PointerEvent` with its own
   * `pointerType` in current engines; one without a pointer type and with
   * `detail` 0 was a keyboard activation. A browser that still sends `click`
   * as a plain `MouseEvent` is answered from the press before it.
   */
  #clickKind(event: MouseEvent): PointerKind | 'keyboard' {
    const own = pointerKind((event as Partial<PointerEvent>).pointerType)
    if (own) return own
    if (event.detail === 0) return 'keyboard'
    return this.#pressKind ?? 'mouse'
  }

  #keyDown(event: KeyboardEvent): void {
    if (this.#trust(event) && this.#unfocused()) this.#add('trusted_unfocused')
    const now = this.#now()
    this.#add('keydowns')
    if (now - this.#lastKey < FAST_KEY_MS) this.#add('keys_fast')
    this.#lastKey = now
    if (typeof event.key === 'string' && SCROLL_KEYS.has(event.key)) this.#lastScrollPrompt = now
  }

  #input(event: InputEvent): void {
    this.#trust(event)
    switch ((event as Partial<InputEvent>).inputType) {
      case 'insertText':
        this.#add(
          this.#now() - this.#lastKey <= TYPED_AFTER_KEY_MS ? 'inputs_typed' : 'inputs_inserted',
        )
        return
      case 'insertFromPaste':
        this.#add('inputs_pasted')
        return
      case 'insertReplacementText':
        this.#add('inputs_replaced')
        return
      default:
        this.#add('inputs_other')
    }
  }

  #wheel(event: WheelEvent): void {
    this.#add('wheels')
    this.#lastScrollPrompt = this.#now()
    if (event.deltaMode !== 0) return
    const x = deltaOf(event.deltaX)
    const y = deltaOf(event.deltaY)
    if ((x !== 0 || y !== 0) && x % 100 === 0 && y % 100 === 0) this.#add('wheels_round')
  }

  #scroll(): void {
    if (this.#now() - this.#lastScrollPrompt > SCROLL_PROMPT_MS) this.#add('scrolls_unprompted')
  }

  #resize(): void {
    const width = window.innerWidth
    const height = window.innerHeight
    if (this.#width !== undefined && this.#height !== undefined && width === this.#width) {
      const drop = this.#height - height
      if (drop >= VIEWPORT_STEP_MIN_PX && drop <= VIEWPORT_STEP_MAX_PX) this.#add('viewport_steps')
    }
    this.#width = width
    this.#height = height
  }

  /**
   * Watches for added elements, and reads the computed style of at most
   * [[OVERLAY_CHECKS_PER_BATCH]] of them per batch, after the page's own work
   * in that task is done. Only elements added directly are read, never their
   * descendants.
   */
  #observeOverlays(): void {
    if (typeof MutationObserver !== 'function') return
    const root = document.documentElement
    if (!root) return
    const observer = new MutationObserver((records) => {
      try {
        this.#queueOverlays(records)
      } catch {
        /* an observation must never break the page */
      }
    })
    observer.observe(root, { childList: true, subtree: true })
    this.#teardown.push(() => observer.disconnect())
  }

  #queueOverlays(records: MutationRecord[]): void {
    for (const record of records) {
      if (this.#pendingOverlays.length >= OVERLAY_CHECKS_PER_BATCH) break
      const added = record.addedNodes
      for (let i = 0; i < added.length; i++) {
        if (this.#pendingOverlays.length >= OVERLAY_CHECKS_PER_BATCH) break
        const node = added[i]
        if (!node || node.nodeType !== 1 || this.#checked.has(node)) continue
        this.#checked.add(node)
        this.#pendingOverlays.push(node as Element)
      }
    }
    if (this.#pendingOverlays.length > 0 && this.#overlayTimer === undefined) {
      this.#overlayTimer = setTimeout(() => {
        this.#overlayTimer = undefined
        try {
          this.#checkOverlays()
        } catch {
          /* an observation must never break the page */
        }
      }, 0)
    }
  }

  #checkOverlays(): void {
    const pending = this.#pendingOverlays
    if (pending.length === 0) return
    this.#pendingOverlays = []
    for (const element of pending) {
      if (!element.isConnected) continue
      const style = getComputedStyle(element)
      if (
        (style.position === 'fixed' || style.position === 'absolute') &&
        style.pointerEvents === 'none' &&
        Number.parseInt(style.zIndex, 10) >= OVERLAY_MIN_Z
      ) {
        this.#add('overlays')
      }
    }
  }
}

/** Whether a mouse click landed within [[CENTRE_PX]] of its target's centre. */
function atCentre(event: MouseEvent): boolean {
  const target = event.target as Partial<Element> | null
  if (!target || typeof target.getBoundingClientRect !== 'function') return false
  const rect = target.getBoundingClientRect()
  if (!(rect.width > 0) || !(rect.height > 0)) return false
  const dx = Math.abs(event.clientX - (rect.left + rect.width / 2))
  const dy = Math.abs(event.clientY - (rect.top + rect.height / 2))
  return dx <= CENTRE_PX && dy <= CENTRE_PX
}

/** The page's one observer, shared by every client that asked for it. */
let pageObserver: InteractionObserver | undefined
let holders = 0
/** Moves on at every withdrawal, so a hold taken before one releases nothing. */
let generation = 0

/** One client's claim on the page observer. */
export interface InteractionHold {
  /** Lets go; the observer stops when no current hold is left. */
  release(): void
  /** Whether the hold still keeps the observer running (no withdrawal since). */
  readonly current: boolean
}

interface HoldRegistry {
  register(target: object, held: InteractionHold, token: object): void
  unregister(token: object): boolean
}
type HoldRegistryConstructor = new (cleanup: (held: InteractionHold) => void) => HoldRegistry

/**
 * Lets go of a client's hold once the client itself is gone: a framework
 * binding that rebuilds its client (new options, a remounted provider, an
 * unmounted app) drops the old one without withdrawing its consent, and the
 * observer must not keep running for a client nobody can read.
 */
const abandoned = ((): HoldRegistry | undefined => {
  // Not in the ES2020 lib this package builds against, and absent before
  // Safari 14.1; without it a dropped client keeps its hold until a withdrawal.
  const Registry = (globalThis as { FinalizationRegistry?: HoldRegistryConstructor })
    .FinalizationRegistry
  return typeof Registry === 'function'
    ? new Registry((hold: InteractionHold) => hold.release())
    : undefined
})()

/**
 * Starts the page's interaction observer for `owner`, a client built with
 * `agentDetection: 'interaction'`, once collection is permitted. The observer
 * stops, and its counts are dropped, when the last client holding it lets go
 * or is garbage collected, and at once when any of them sees consent
 * withdrawn ([[withdrawInteractionObserver]]).
 */
export function startInteractionObserver(owner?: object): InteractionHold {
  pageObserver ??= new InteractionObserver()
  holders += 1
  if (!pageObserver.running) pageObserver.start()
  const taken = generation
  let released = false
  const hold: InteractionHold = {
    get current() {
      return !released && taken === generation
    },
    release() {
      if (released) return
      released = true
      abandoned?.unregister(hold)
      if (taken !== generation) return
      holders -= 1
      if (holders <= 0) {
        holders = 0
        pageObserver?.stop()
      }
    },
  }
  if (owner !== undefined) abandoned?.register(owner, hold, hold)
  return hold
}

/**
 * Consent withdrawn: the visitor's answer, so it holds for the whole page.
 * The observer stops and drops its counts whoever else still holds it, and
 * only a client that sees consent granted again starts it afresh.
 */
export function withdrawInteractionObserver(): void {
  generation += 1
  holders = 0
  pageObserver?.stop()
}

export const interactionSource: Source<InteractionSignal> = {
  id: SOURCE.interaction,
  stage: 'collect',
  optIn: 'agent-interaction',
  // Left out of the report while nothing is observing: replaced sources, an
  // app's web view, or consent withdrawn since the client was built.
  active: () => pageObserver?.running === true,
  timeoutMs: 50,
  run() {
    const observer = pageObserver
    if (!observer?.running) throw new UnsupportedSignal('not-observing')
    return observer.take()
  },
}
