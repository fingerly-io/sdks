/**
 * What a component asks for: the identification.
 */

import type { IncognitoDetection } from '@fingerly/web-js'

import { useFingerly } from './context.js'
import type { Fingerly } from './state.svelte.js'

export interface UseIdentifyOptions {
  /** Identify as soon as the component mounts (after consent is `'granted'`). */
  immediate?: boolean
  /** Opaque correlation label echoed on the event. */
  tag?: string | (() => string | undefined)
  /** Opt-in extended incognito probe control (`'standard'` or `'extended'`). */
  incognitoDetection?: IncognitoDetection | (() => IncognitoDetection | undefined)
}

export function useIdentify(options: UseIdentifyOptions = {}): Fingerly {
  const fingerly = useFingerly()

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
    $effect(() => {
      if (fingerly.consent !== 'granted') return
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
  }

  return {
    get requestId() {
      return fingerly.requestId
    },
    get visitorId() {
      return fingerly.visitorId
    },
    get visitorIsNew() {
      return fingerly.visitorIsNew
    },
    get visitorConfidence() {
      return fingerly.visitorConfidence
    },
    get identifiable() {
      return fingerly.identifiable
    },
    get duplicate() {
      return fingerly.duplicate
    },
    get state() {
      return fingerly.state
    },
    get suspectScore() {
      return fingerly.suspectScore
    },
    get suspectLevel() {
      return fingerly.suspectLevel
    },
    get report() {
      return fingerly.report
    },
    get error() {
      return fingerly.error
    },
    get isLoading() {
      return fingerly.isLoading
    },
    get isReady() {
      return fingerly.isReady
    },
    get isSuspicious() {
      return fingerly.isSuspicious
    },
    get consent() {
      return fingerly.consent
    },
    setConsent: fingerly.setConsent,
    identify,
    refresh,
    client: fingerly.client,
  }
}
