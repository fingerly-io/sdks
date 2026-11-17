/**
 * The proof of work a web ticket can ask for (`pow_bits` above 0): the
 * smallest decimal nonce `n`, from "0" upward, such that
 * `SHA256(ticket || ":" || n)` starts with at least `pow_bits` zero bits.
 *
 * The search runs off the main thread in a Worker when the page allows one,
 * and in short time slices otherwise, always within [[POW_BUDGET_MS]]. When
 * the budget runs out the answer is `undefined` and the report goes without
 * `ticket_pow`; the server decides what that means.
 */

/** The most time a ticket's proof of work may take, from when the ticket arrived. */
export const POW_BUDGET_MS = 1500

/** The largest `pow_bits` the server sends. */
export const MAX_POW_BITS = 22

/** How long one time slice may hold the main thread when no Worker is available. */
const SLICE_MS = 8

/** Nonces tried between clock reads in a time slice. */
const SLICE_STEP = 256

/** The highest nonce a Worker searches up to before it gives up by itself. */
const WORKER_LIMIT = 2 ** 31

/**
 * Searches nonces `from` (inclusive) to `to` (exclusive) and returns the first
 * that passes, or `-1`. Synchronous, with its own SHA-256 and no reference to
 * anything outside its body, so its source text also runs as a Worker.
 * `bits` must be 1 to 32; the ticket is ASCII (unpadded base64url).
 */
export function powSearch(ticket: string, bits: number, from: number, to: number): number {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const W = new Int32Array(64)

  function compress(H: Int32Array, block: Uint8Array, offset: number): void {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4
      W[i] = (block[j]! << 24) | (block[j + 1]! << 16) | (block[j + 2]! << 8) | block[j + 3]!
    }
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15]!
      const w2 = W[i - 2]!
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3)
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10)
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) | 0
    }
    let a = H[0]!
    let b = H[1]!
    let c = H[2]!
    let d = H[3]!
    let e = H[4]!
    let f = H[5]!
    let g = H[6]!
    let h = H[7]!
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i]! + W[i]!) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    H[0] = (H[0]! + a) | 0
    H[1] = (H[1]! + b) | 0
    H[2] = (H[2]! + c) | 0
    H[3] = (H[3]! + d) | 0
    H[4] = (H[4]! + e) | 0
    H[5] = (H[5]! + f) | 0
    H[6] = (H[6]! + g) | 0
    H[7] = (H[7]! + h) | 0
  }

  // The ticket and the colon do not change between nonces: their whole
  // blocks are hashed once, and each nonce only hashes the last one or two.
  const prefix = new Uint8Array(ticket.length + 1)
  for (let i = 0; i < ticket.length; i++) prefix[i] = ticket.charCodeAt(i) & 0xff
  prefix[ticket.length] = 0x3a
  const mid = new Int32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const whole = Math.floor(prefix.length / 64)
  for (let b = 0; b < whole; b++) compress(mid, prefix, b * 64)
  const tail = prefix.subarray(whole * 64)

  const buffer = new Uint8Array(128)
  const H = new Int32Array(8)
  const shift = 32 - bits
  for (let n = from; n < to; n++) {
    const digits = String(n)
    const used = tail.length + digits.length
    const blocks = used + 9 <= 64 ? 1 : 2
    buffer.fill(0)
    buffer.set(tail, 0)
    for (let i = 0; i < digits.length; i++) buffer[tail.length + i] = digits.charCodeAt(i)
    buffer[used] = 0x80
    const bitLength = (prefix.length + digits.length) * 8
    const end = blocks * 64
    buffer[end - 5] = Math.floor(bitLength / 2 ** 32) & 0xff
    buffer[end - 4] = (bitLength >>> 24) & 0xff
    buffer[end - 3] = (bitLength >>> 16) & 0xff
    buffer[end - 2] = (bitLength >>> 8) & 0xff
    buffer[end - 1] = bitLength & 0xff
    H.set(mid)
    compress(H, buffer, 0)
    if (blocks === 2) compress(H, buffer, 64)
    if (H[0]! >>> shift === 0) return n
  }
  return -1
}

/** The Worker's whole program: the search above, answering one message. */
export function powWorkerSource(): string {
  return (
    `const powSearch = ${powSearch.toString()};\n` +
    'self.onmessage = (event) => {\n' +
    '  const d = event.data;\n' +
    '  self.postMessage(powSearch(d.ticket, d.bits, 0, d.limit));\n' +
    '};\n'
  )
}

export interface SolveOptions {
  /** Defaults to [[POW_BUDGET_MS]]. */
  budgetMs?: number
  /** Whether to try a Worker first. Defaults to true; tests turn it off. */
  worker?: boolean
}

function now(): number {
  const clock = (globalThis as { performance?: { now(): number } }).performance
  return typeof clock?.now === 'function' ? clock.now() : Date.now()
}

function nextSlice(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function solveInSlices(ticket: string, bits: number, deadline: number): Promise<string | undefined> {
  let n = 0
  while (now() < deadline) {
    const sliceEnd = Math.min(deadline, now() + SLICE_MS)
    while (now() < sliceEnd) {
      const found = powSearch(ticket, bits, n, n + SLICE_STEP)
      if (found >= 0) return String(found)
      n += SLICE_STEP
    }
    await nextSlice()
  }
  return undefined
}

interface WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  postMessage(message: unknown): void
  terminate(): void
}

type WorkerConstructor = new (url: string) => WorkerLike

/**
 * Runs the search in a Worker made from a `blob:` URL. Resolves to the nonce,
 * `undefined` at the deadline, or `null` when no Worker could run (none in
 * this runtime, or a Content Security Policy that refuses `blob:` workers), so
 * the caller can fall back to time slices.
 */
function solveInWorker(ticket: string, bits: number, deadline: number): Promise<string | undefined | null> {
  const scope = globalThis as {
    Worker?: WorkerConstructor
    Blob?: typeof Blob
    URL?: { createObjectURL?(blob: Blob): string; revokeObjectURL?(url: string): void }
  }
  const WorkerImpl = scope.Worker
  if (
    typeof WorkerImpl !== 'function' ||
    typeof scope.Blob !== 'function' ||
    typeof scope.URL?.createObjectURL !== 'function'
  ) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    let url: string | undefined
    let worker: WorkerLike | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (value: string | undefined | null) => {
      clearTimeout(timer)
      try {
        worker?.terminate()
      } catch {
        // already gone
      }
      if (url !== undefined) scope.URL?.revokeObjectURL?.(url)
      resolve(value)
    }
    try {
      url = scope.URL!.createObjectURL!(new scope.Blob!([powWorkerSource()], { type: 'text/javascript' }))
      worker = new WorkerImpl(url)
      worker.onmessage = (event) => {
        const found = event.data
        finish(typeof found === 'number' && found >= 0 ? String(found) : undefined)
      }
      worker.onerror = () => finish(null)
      timer = setTimeout(() => finish(undefined), Math.max(0, deadline - now()))
      worker.postMessage({ ticket, bits, limit: WORKER_LIMIT })
    } catch {
      finish(null)
    }
  })
}

/**
 * Solves a ticket's proof of work within the budget. Never rejects: any
 * failure, or running out of time, resolves to `undefined`.
 */
export async function solvePow(
  ticket: string,
  bits: number,
  options: SolveOptions = {},
): Promise<string | undefined> {
  if (!Number.isInteger(bits) || bits < 1 || bits > MAX_POW_BITS) return undefined
  const deadline = now() + (options.budgetMs ?? POW_BUDGET_MS)
  try {
    if (options.worker !== false) {
      const answer = await solveInWorker(ticket, bits, deadline)
      if (answer !== null) return answer
    }
    return await solveInSlices(ticket, bits, deadline)
  } catch {
    return undefined
  }
}
