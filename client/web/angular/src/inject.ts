/**
 * What a component asks for: the identification.
 */

import { afterNextRender, effect, inject, Injector, untracked } from '@angular/core'
import type { IncognitoDetection } from '@fingerly/web-js'

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
  /** Identify as soon as the browser has rendered (after consent is `'granted'`). */
  immediate?: boolean
  /** Opaque correlation label echoed on the event. */
  tag?: string | (() => string | undefined)
  /** Opt-in extended incognito probe control (`'standard'` or `'extended'`). */
  incognitoDetection?: IncognitoDetection | (() => IncognitoDetection | undefined)
}

export function injectIdentify(options: InjectIdentifyOptions = {}): Fingerly {
  const fingerly = injectFingerly()
  const injector = inject(Injector)

  const resolveTag = (override?: string): string | undefined =>
    override ?? (typeof options.tag === 'function' ? options.tag() : options.tag)
  const resolveIncognito = (override?: IncognitoDetection): IncognitoDetection | undefined =>
    override ??
    (typeof options.incognitoDetection === 'function'
      ? options.incognitoDetection()
      : options.incognitoDetection)

  const identify: Fingerly['identify'] = (callOptions = {}) => {
    const tag = resolveTag(callOptions.tag)
    const incognitoDetection = resolveIncognito(callOptions.incognitoDetection)
    return fingerly.identify({
      ...(tag === undefined ? {} : { tag }),
      ...(incognitoDetection === undefined ? {} : { incognitoDetection }),
      ...(callOptions.force === undefined ? {} : { force: callOptions.force }),
    })
  }

  const refresh: Fingerly['refresh'] = (callOptions = {}) =>
    identify({ ...callOptions, force: true })

  if (options.immediate) {
    afterNextRender(
      () => {
        effect(
          () => {
            if (fingerly.consent() !== 'granted') return
            untracked(() => {
              const tag = resolveTag()
              const incognitoDetection = resolveIncognito()
              void fingerly
                .identify({
                  ...(tag === undefined ? {} : { tag }),
                  ...(incognitoDetection === undefined ? {} : { incognitoDetection }),
                  automatic: true,
                })
                .catch(() => undefined)
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
