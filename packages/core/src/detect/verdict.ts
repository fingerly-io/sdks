/**
 * How a detector adds up its evidence.
 *
 * Every detector in this folder is a weighted vote rather than a chain of
 * `if`s. Two reasons: a single tell is almost never conclusive on its own -
 * `navigator.webdriver` is one line to remove - and a verdict a customer will
 * use to block a user has to be able to say *why*, with the weights visible
 * rather than buried in control flow.
 */

import type { Confidence, Verdict } from '../types.js'

export interface Evidence {
  /** Short, stable, and meant to be read by a human in a dashboard. */
  reason: string
  /**
   * How much this tell is worth, roughly 0-1.
   *
   * Calibrated by how hard the tell is to remove, not by how suspicious it
   * feels. A clamped clock resolution is worth far more than a missing plugin
   * array, because one requires a patched browser build and the other requires
   * a one-line override.
   */
  weight: number
}

/**
 * Sum the evidence that fired into a verdict.
 *
 * The thresholds are deliberately not symmetric with the weights. `value` goes
 * true at 1.0 - one decisive tell, or several weak ones agreeing - while `high`
 * confidence needs 2.0, which no single tell can reach alone. That shape is the
 * policy: never call something a bot on one removable flag.
 *
 * `scale` dampens the whole sum, for the case where a precondition of the
 * detector is not met but the evidence is still real. A detector that is
 * specific to one engine and finds all its tells on another has found
 * *something* - and it is not the thing it was looking for. Subtracting a fixed
 * penalty cannot express that, because a pile of tells outruns any constant;
 * scaling keeps the finding and moves it out of `high`.
 */
export function weigh(evidence: Evidence[], scale = 1): Verdict {
  const score = evidence.reduce((total, item) => total + item.weight, 0) * scale

  let confidence: Confidence = 'low'
  if (score >= 2) confidence = 'high'
  else if (score >= 1.25) confidence = 'medium'

  return {
    value: score >= 1,
    confidence,
    // Strongest first: a dashboard truncating this list should keep the tell
    // that actually drove the verdict, not whichever one was collected first.
    reasons: [...evidence].sort((a, b) => b.weight - a.weight).map((item) => item.reason),
  }
}

/** A verdict with nothing behind it. Used when the inputs are missing entirely. */
export function unknown(): Verdict {
  return { value: false, confidence: 'low', reasons: [] }
}
