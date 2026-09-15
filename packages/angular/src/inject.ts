/**
 * The two things a component asks for: the identification, and one verdict.
 *
 * Named `inject…` rather than the `use…` the other bindings use, because in
 * Angular the prefix carries a rule: these must run in an injection context -
 * a field initialiser, a constructor, or inside `runInInjectionContext`. A
 * name that hid that would be a name that made the error message a surprise.
 */

import {
  afterNextRender,
  computed,
  inject,
  Injector,
  type Signal,
} from '@angular/core'
import type { Confidence, Verdict, Verdicts } from '@fingerly/web-js'

import { FINGERLY } from './provide.js'
import type { Fingerly } from './state.js'

export type VerdictName = keyof Verdicts

/** The shared state. Throws, with an explanation, if nothing provided it. */
export function injectFingerly(): Fingerly {
  const fingerly = inject(FINGERLY, { optional: true })

  if (!fingerly) {
    throw new Error(
      'No Fingerly provider found. Add one where the application is bootstrapped:\n\n' +
        "  import { provideFingerly } from '@fingerly/angular'\n" +
        "  bootstrapApplication(App, { providers: [provideFingerly({ apiKey: 'pk_live_…' })] })",
    )
  }

  return fingerly
}

export interface InjectIdentifyOptions {
  /**
   * Identify as soon as the browser has rendered.
   *
   * Safe in every component that wants it: the injector holds one shared
   * state, so the second and third callers get the first one's answer rather
   * than starting their own submission.
   *
   * It runs in `afterNextRender`, which is what makes it server-safe -
   * Angular does not run those callbacks during server-side rendering, so a
   * page renders on the server and collects in the browser with no platform
   * check of its own.
   */
  immediate?: boolean
  /**
   * The customer's own correlation value, echoed back on the finished event.
   *
   * Accepts a signal or a getter as well as a string, so it can be
   * `this.orderId` and be read at the moment of submission rather than at the
   * moment the component was constructed.
   */
  tag?: string | (() => string | undefined)
}

/**
 * The shared identification, optionally started once the page has rendered.
 *
 * ```ts
 * @Component({
 *   template: `@if (fingerly.isSuspicious()) { <p>Unusual session</p> }`,
 * })
 * export class Checkout {
 *   readonly fingerly = injectIdentify({ immediate: true })
 * }
 * ```
 */
export function injectIdentify(options: InjectIdentifyOptions = {}): Fingerly {
  const fingerly = injectFingerly()
  const injector = inject(Injector)

  const resolveTag = (override?: string): string | undefined =>
    override ?? (typeof options.tag === 'function' ? options.tag() : options.tag)

  // Wrapped rather than handed back as-is, so a `tag` applies to every call
  // this component makes and not only to the one `immediate` starts. Every
  // signal below is the shared one; what is per-component here is the tag,
  // and nothing else.
  const identify: Fingerly['identify'] = (callOptions = {}) => {
    const tag = resolveTag(callOptions.tag)
    return fingerly.identify({
      ...(tag === undefined ? {} : { tag }),
      ...(callOptions.force === undefined ? {} : { force: callOptions.force }),
    })
  }

  const refresh: Fingerly['refresh'] = (callOptions = {}) => identify({ ...callOptions, force: true })

  if (options.immediate) {
    afterNextRender(
      () => {
        // The rejection is swallowed rather than left to become an unhandled
        // one: the failure is already in `fingerly.error()`, which is where a
        // component that opted into `immediate` will look for it. A caller who
        // wants to await the outcome calls identify() themselves.
        void identify().catch(() => undefined)
      },
      { injector },
    )
  }

  return { ...fingerly, identify, refresh }
}

export interface InjectVerdictResult {
  /** True only when the verdict fired *and* met the confidence floor. */
  readonly matched: Signal<boolean>
  /** The verdict itself, or null before the first identification. */
  readonly verdict: Signal<Verdict | null>
  readonly confidence: Signal<Confidence | null>
  /** Why, strongest first. Empty before identification, never null. */
  readonly reasons: Signal<readonly string[]>
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }

/** One array for every un-identified verdict, rather than one per read. */
const NO_REASONS: readonly string[] = Object.freeze([])

/**
 * Watch one verdict.
 *
 * ```ts
 * readonly automation = injectVerdict('automation', { min: 'high' })
 * ```
 *
 * `min` defaults to `medium`. A `low`-confidence verdict is a single weak tell
 * - one removable flag, or one countermeasure a privacy-conscious real user
 * might equally be running - and defaulting to acting on it would make this a
 * false-positive generator. Pass `min: 'low'` deliberately if the intent is to
 * observe rather than to block.
 *
 * Both arguments take a signal as well as a value, because this is called once
 * when the component is constructed and either may be an input that changes
 * afterwards.
 */
export function injectVerdict(
  name: VerdictName | Signal<VerdictName> | (() => VerdictName),
  options: { min?: Confidence | Signal<Confidence> | (() => Confidence) } = {},
): InjectVerdictResult {
  const fingerly = injectFingerly()

  const which = computed(() => (typeof name === 'function' ? name() : name))
  const floor = computed(() =>
    typeof options.min === 'function' ? options.min() : (options.min ?? 'medium'),
  )

  const verdict = computed<Verdict | null>(() => {
    const all = fingerly.verdicts()
    return all ? (all[which()] as Verdict) : null
  })

  return {
    verdict,
    confidence: computed(() => verdict()?.confidence ?? null),
    reasons: computed(() => verdict()?.reasons ?? NO_REASONS),
    matched: computed(() => {
      const current = verdict()
      if (!current?.value) return false
      return RANK[current.confidence] >= RANK[floor()]
    }),
  }
}
