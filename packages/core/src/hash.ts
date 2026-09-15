/**
 * A stable non-cryptographic hash, for compaction only.
 *
 * # What this is for
 *
 * Some sources produce values far too large to submit: a canvas readback is
 * hundreds of kilobytes of pixels, and a font probe can enumerate hundreds of
 * measurements. Those get hashed here so the report stays small.
 *
 * # What this is not for
 *
 * The visitor identifier. Fingerly does not compute one in the page - see the
 * note on [[IdentifyResult]]. This function exists so that a *field* can be
 * compacted, not so that an identity can be minted client-side. Hashing the
 * whole report here would reintroduce exactly the problem that decision avoids.
 *
 * The algorithm is xxHash32, run twice with different seeds to give 64 bits.
 * Chosen because it is fast, has no dependencies, and - the part that matters -
 * is a published algorithm with fixed test vectors, so an implementation on
 * another platform can be checked against this one rather than trusted.
 */

const P1 = 0x9e3779b1
const P2 = 0x85ebca77
const P3 = 0xc2b2ae3d
const P4 = 0x27d4eb2f
const P5 = 0x165667b1

function rotl(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits))
}

function round(acc: number, input: number): number {
  return Math.imul(rotl((acc + Math.imul(input, P2)) | 0, 13), P1)
}

function readU32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] ?? 0) |
      ((bytes[at + 1] ?? 0) << 8) |
      ((bytes[at + 2] ?? 0) << 16) |
      ((bytes[at + 3] ?? 0) << 24)) >>>
    0
  )
}

/** UTF-8 bytes, using the platform encoder where there is one. */
function utf8(input: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(input)
  }

  // Older WebViews - some Android 5/6 stock browsers reach this. Encoding by
  // hand rather than falling back to char codes, because a hash over UTF-16
  // code units would disagree with every other platform's hash of the same
  // string, and these values are compared across SDKs.
  const out: number[] = []
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i)

    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const low = input.charCodeAt(i + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000
        i++
      }
    }

    if (code < 0x80) {
      out.push(code)
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return new Uint8Array(out)
}

function xxh32(bytes: Uint8Array, seed: number): number {
  const length = bytes.length
  let index = 0
  let hash: number

  if (length >= 16) {
    let v1 = (seed + P1 + P2) | 0
    let v2 = (seed + P2) | 0
    let v3 = seed | 0
    let v4 = (seed - P1) | 0
    const limit = length - 16

    do {
      v1 = round(v1, readU32(bytes, index))
      v2 = round(v2, readU32(bytes, index + 4))
      v3 = round(v3, readU32(bytes, index + 8))
      v4 = round(v4, readU32(bytes, index + 12))
      index += 16
    } while (index <= limit)

    hash = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) | 0
  } else {
    hash = (seed + P5) | 0
  }

  hash = (hash + length) | 0

  while (index + 4 <= length) {
    hash = Math.imul(rotl((hash + Math.imul(readU32(bytes, index), P3)) | 0, 17), P4)
    index += 4
  }

  while (index < length) {
    hash = Math.imul(rotl((hash + Math.imul(bytes[index] ?? 0, P5)) | 0, 11), P1)
    index++
  }

  hash ^= hash >>> 15
  hash = Math.imul(hash, P2)
  hash ^= hash >>> 13
  hash = Math.imul(hash, P3)
  hash ^= hash >>> 16

  return hash >>> 0
}

function hex8(value: number): string {
  return value.toString(16).padStart(8, '0')
}

/**
 * 64 bits of hash, as 16 lowercase hex characters.
 *
 * Two seeded 32-bit passes rather than one, because a 32-bit digest collides at
 * around 77,000 distinct values by the birthday bound - which a customer with
 * real traffic reaches inside a day, and a silent collision in a canvas hash
 * would merge two devices into one visitor.
 */
export function hash64(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? utf8(input) : input
  return hex8(xxh32(bytes, 0)) + hex8(xxh32(bytes, P1))
}
