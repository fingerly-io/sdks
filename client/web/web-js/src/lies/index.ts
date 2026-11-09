/**
 * The tamper layer.
 *
 * Runs after collection, over the outcomes, and produces the
 * [[IntegrityReport]] that goes on the wire beside them. It is not a source,
 * for two reasons: it reads what the other sources produced, so it cannot run
 * beside them; and a tamper check that competed for the budget could be starved
 * by a slow source, which is precisely the outcome an attacker would arrange.
 *
 * What it reports is raw: which natives are patched, which properties were
 * redefined. Whether the reported values contradict each other - a user agent
 * claiming a phone that hovers, a language that is not the first of its own
 * languages - is the server's reading of the same sources, not something the
 * page decides.
 */

import { SOURCE, valueOf, type EngineSignal, type IntegrityReport, type SignalOutcome } from '@fingerly/core'

import { windowOrNull } from '../util.js'
import { findRedefinedProperties } from './descriptors.js'
import { findPatchedNatives } from './natives.js'

export { findRedefinedProperties } from './descriptors.js'
export { findPatchedNatives } from './natives.js'

export function inspectIntegrity(sources: Record<string, SignalOutcome>): IntegrityReport {
  const w = windowOrNull()

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
  }

  if (!w) {
    // No DOM to inspect, so nothing here to report. The server still compares
    // the reported sources against each other.
    return { patched_natives: [], lies: [], engine: identity }
  }

  const natives = findPatchedNatives(w)
  const descriptors = findRedefinedProperties(w)

  return {
    patched_natives: natives.patched,
    lies: [...natives.lies, ...descriptors],
    engine: identity,
  }
}
