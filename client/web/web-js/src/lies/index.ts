/**
 * The tamper layer (`F-11`).
 *
 * Runs after collection over the gathered outcomes and produces the
 * [[IntegrityReport]] that goes on the wire alongside `sources`.
 */

import {
  SOURCE,
  valueOf,
  type EngineSignal,
  type IntegrityReport,
  type SignalOutcome,
} from '@fingerly/core'

import { windowOrNull } from '../util.js'
import { findRedefinedProperties } from './descriptors.js'
import { borrowRealmToString, findPatchedNatives } from './natives.js'

export { findRedefinedProperties } from './descriptors.js'
export { borrowRealmToString, findPatchedNatives } from './natives.js'

export function inspectIntegrity(sources: Record<string, SignalOutcome>): IntegrityReport {
  const w = windowOrNull()

  const engine = valueOf<EngineSignal>(
    {
      schema: 1,
      budget_ms: 0,
      elapsed_ms: 0,
      sources,
      integrity: { patched_natives: [], lies: [], engine: {} },
    },
    SOURCE.engine,
  )

  const identity = {
    ...(engine?.claimed === undefined ? {} : { claimed: engine.claimed }),
    ...(engine?.observed === undefined ? {} : { observed: engine.observed }),
  }

  if (!w) {
    return { patched_natives: [], lies: [], engine: identity }
  }

  const realm = borrowRealmToString()
  const natives = findPatchedNatives(w, realm)
  const descriptors = findRedefinedProperties(w, realm.stringify)

  return {
    patched_natives: natives.patched,
    lies: [...natives.lies, ...descriptors],
    engine: identity,
  }
}
