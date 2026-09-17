/**
 * The tamper layer.
 *
 * Runs after collection, over the outcomes, and produces the
 * [[IntegrityReport]] that goes on the wire beside them. It is not a source,
 * for two reasons: it reads what the other sources produced, so it cannot run
 * beside them; and a tamper check that competed for the budget could be starved
 * by a slow source, which is precisely the outcome an attacker would arrange.
 */

import { SOURCE, valueOf, type EngineSignal, type IntegrityReport, type SignalOutcome } from '@fingerly/core'

import { windowOrNull } from '../util.js'
import { findContradictions } from './contradictions.js'
import { findRedefinedProperties } from './descriptors.js'
import { findPatchedNatives } from './natives.js'

export { findContradictions } from './contradictions.js'
export { findRedefinedProperties } from './descriptors.js'
export { findPatchedNatives } from './natives.js'

export function inspectIntegrity(sources: Record<string, SignalOutcome>): IntegrityReport {
  const w = windowOrNull()

  const contradictions = findContradictions(sources)

  const engine = valueOf<EngineSignal>(
    {
      schema: 1,
      budget_ms: 0,
      elapsed_ms: 0,
      tiers: [],
      sources,
      integrity: { patched_natives: [], lies: [], engine: {} },
    },
    SOURCE.engine,
  )

  const identity = {
    ...(engine?.claimed === undefined ? {} : { claimed: engine.claimed }),
    ...(engine?.observed === undefined ? {} : { observed: engine.observed }),
    ...(engine?.agrees === undefined ? {} : { agrees: engine.agrees }),
  }

  if (!w) {
    // No DOM to inspect. The contradictions still hold - they are computed from
    // reported values - so they are kept rather than the whole report being
    // dropped.
    return { patched_natives: [], lies: contradictions, engine: identity }
  }

  const natives = findPatchedNatives(w)
  const descriptors = findRedefinedProperties(w)

  return {
    patched_natives: natives.patched,
    lies: [...natives.lies, ...descriptors, ...contradictions],
    engine: identity,
  }
}
