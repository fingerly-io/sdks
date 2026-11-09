/**
 * Whether `suspectLevel` says the check is worth a look.
 *
 * Null whenever the level is absent, which covers unscored and hidden alike,
 * and for a level this version does not know: only an explicit `low` is clean.
 * Nothing is decided here. The server set the level, under the customer's
 * weights.
 */
export function isSuspiciousLevel(level: string | null | undefined): boolean | null {
  if (level === 'medium' || level === 'high') return true
  return level === 'low' ? false : null
}
