/**
 * What a component asks for: the identification.
 *
 * Named `inject…` rather than the `use…` the other bindings use, because in
 * Angular the prefix carries a rule: these must run in an injection context -
 * a field initialiser, a constructor, or inside `runInInjectionContext`. A
 * name that hid that would be a name that made the error message a surprise.
 */

import { afterNextRender, effect, inject, Injector, untracked } from '@angular/core'

import { FINGERLY } from './provide.js'
import type { Fingerly } from './state.js'

/** The shared state. Throws, with an explanation, if nothing provided it. */
export function injectFingerly(): Fingerly {
  const fingerly = inject(FINGERLY, { optional: true })

  if (!fingerly) {
    throw new Error(
      'No Fingerly provider found. Add one where the application is bootstrapped:\n\n' +
        "  import { provideFingerly } from '@fingerly/angular'\n" +
        "  bootstrapApplication(App, { providers: [provideFingerly({ apiKey: 'fly_pk_production_…' })] })",
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
   *
   * It waits for consent. While `consent()` is `pending` or `denied` nothing
   * is started, and the identification begins once it becomes `granted`.
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
        // An effect rather than one read, so a banner accepted after the
        // render starts the identification that was waiting for it. Once: the
        // shared state memoises the run, so consent flipping back and forth
        // afterwards submits nothing more. Created with this injector, so it
        // is destroyed with the component that asked for it.
        effect(
          () => {
            if (fingerly.consent() !== 'granted') return
            // Untracked: only consent should re-run this. A signal read while
            // identifying - a `tag` given as one - must not start another.
            untracked(() => {
              // The rejection is swallowed rather than left to become an
              // unhandled one: the failure is already in `fingerly.error()`,
              // which is where a component that opted into `immediate` will
              // look for it. A caller who wants to await the outcome calls
              // identify() themselves.
              // Marked automatic, so a failure's hold applies: a component
              // created while the API is refusing must not send another.
              const tag = resolveTag()
              void fingerly.identify({ ...(tag === undefined ? {} : { tag }), automatic: true }).catch(() => undefined)
            })
          },
          { injector },
        )
      },
      { injector },
    )
  }

  return { ...fingerly, identify, refresh }
}
