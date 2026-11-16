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
  type Lie,
  type SignalOutcome,
} from '@fingerly/core'

import { windowOrNull } from '../util.js'
import { findRedefinedProperties } from './descriptors.js'
import { borrowRealmToString, findPatchedNatives } from './natives.js'

export { findRedefinedProperties } from './descriptors.js'
export { borrowRealmToString, findPatchedNatives, type BorrowedRealm } from './natives.js'

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

  // Each pass reads page globals an earlier script controls. One that throws
  // is recorded as a lie and the other pass still runs (`WEB-04`).
  const realm = borrowRealmToString()
  let patched: string[] = []
  const lies: Lie[] = []
  try {
    const natives = findPatchedNatives(w, realm)
    patched = natives.patched
    lies.push(...natives.lies)
  } catch {
    lies.push({ id: 'natives', kind: 'unverified_realm', detail: 'inspection-threw' })
  }
  try {
    lies.push(...findRedefinedProperties(w, realm.stringify))
  } catch {
    lies.push({ id: 'descriptors', kind: 'unverified_realm', detail: 'inspection-threw' })
  }

  return {
    patched_natives: patched,
    lies,
    engine: identity,
  }
}
