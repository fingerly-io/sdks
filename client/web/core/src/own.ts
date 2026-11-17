/**
 * Own-property reads for every value that crosses into the SDK from outside:
 * caller options, source objects and server answers.
 *
 * A plain `options.x` falls through to `Object.prototype` when the caller did
 * not set `x`, so a page with a prototype pollution bug (a vulnerable merge or
 * query-string parser) could otherwise change what is collected, where the
 * report is sent, or what the result says. Captured at module load so a later
 * replacement of `Object.prototype.hasOwnProperty` does not change the answer.
 */

const HAS_OWN = Object.prototype.hasOwnProperty

/** Whether `key` is an own property of `value`. False for null and primitives. */
export function hasOwn(value: unknown, key: PropertyKey): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  try {
    return HAS_OWN.call(value, key)
  } catch {
    return false
  }
}

/** `value[key]` when it is an own property, otherwise undefined. */
export function own<T extends object, K extends keyof T>(
  value: T | null | undefined,
  key: K,
): T[K] | undefined {
  if (!hasOwn(value, key)) return undefined
  try {
    return (value as T)[key]
  } catch {
    return undefined
  }
}

/**
 * A null-prototype copy holding only the own enumerable properties of `value`,
 * so later reads can never reach `Object.prototype`.
 */
export function ownCopy<T extends object>(value: T | null | undefined): Partial<T> {
  const out = Object.create(null) as Record<PropertyKey, unknown>
  if (value === null || value === undefined || typeof value !== 'object') return out as Partial<T>
  let keys: string[]
  try {
    keys = Object.keys(value)
  } catch {
    return out as Partial<T>
  }
  for (const key of keys) {
    if (key === '__proto__') continue
    try {
      out[key] = (value as Record<string, unknown>)[key]
    } catch {
      // A throwing getter is not a value.
    }
  }
  return out as Partial<T>
}
