/**
 * Deterministic serialisation.
 *
 * Two runs that observed the same thing must produce byte-identical output, on
 * every engine, or nothing downstream can be compared or hashed. `JSON.stringify`
 * is not that function: it emits object keys in insertion order, so the same
 * report assembled by two code paths serialises differently, and it turns
 * `NaN`, `Infinity` and `undefined` into values that do not round-trip.
 */

/** The subset of JSON this codebase actually produces. */
export type Canonical =
  | string
  | number
  | boolean
  | null
  | Canonical[]
  | { [key: string]: Canonical | undefined }

/**
 * Serialise with object keys sorted, recursively.
 *
 * The non-finite handling deserves its reason written down. `NaN` is a real
 * observation in several sources - a device where a maths builtin diverges, or
 * a canvas that read back nothing - and `JSON.stringify` renders it as `null`,
 * which is also what a genuinely absent value renders as. Collapsing the two
 * would lose the more interesting one, so they are tagged instead. The tags
 * are strings rather than objects so that a naive consumer sees something
 * legible rather than a shape it has to destructure.
 */
export function canonicalize(value: unknown): string {
  return write(value)
}

function write(value: unknown): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)

    case 'boolean':
      return value ? 'true' : 'false'

    case 'number': {
      if (Number.isNaN(value)) return '"@NaN"'
      if (value === Infinity) return '"@Infinity"'
      if (value === -Infinity) return '"@-Infinity"'
      // `Object.is` rather than `=== 0`: negative zero is distinguishable in
      // JS and some numeric sources produce it, but `JSON.stringify(-0)` is
      // `"0"`, so without this the two would be indistinguishable downstream.
      if (Object.is(value, -0)) return '"@-0"'
      return JSON.stringify(value)
    }

    case 'undefined':
      // Only reachable inside an array, where a hole has to occupy its slot.
      // In an object, an undefined value means the key is dropped entirely -
      // see the object branch below.
      return 'null'

    case 'bigint':
      return JSON.stringify(value.toString())

    case 'object':
      break

    default:
      // Functions and symbols. A source returning one is a bug in that source,
      // but it must not be a bug that takes the whole submission down.
      return 'null'
  }

  if (Array.isArray(value)) {
    return `[${value.map(write).join(',')}]`
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const parts: string[] = []

  for (const key of keys) {
    const entry = record[key]
    // An absent optional field and a field explicitly set to undefined must
    // serialise the same, or `exactOptionalPropertyTypes` would be a
    // distinction the type system enforces and the wire format ignores.
    if (entry === undefined) continue
    parts.push(`${JSON.stringify(key)}:${write(entry)}`)
  }

  return `{${parts.join(',')}}`
}
