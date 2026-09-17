/**
 * Getting a submission to the server.
 *
 * The route is `POST /api/v1/identify`, authenticated by an SDK key in
 * `x-api-key` and answering `200 OK` with the verdict. See
 * `server/routers/sdk.go` for the registration and `server/app/app.go` for the
 * cross-origin policy that lets a browser read the answer.
 *
 * It used to answer `202 Accepted` with an identifier and nothing else, on the
 * grounds that the server's work - the address lookup, the identity match -
 * could not happen in the tens of milliseconds a page load can spare. It now
 * does happen there, so the answer comes back with the submission rather than
 * being fetched afterwards, and a caller needs one round trip instead of two.
 */

import { defaultEndpointForKey } from './routing.js'
import type { DeferredSubmission, IdentifySubmission } from './types.js'

export const IDENTIFY_PATH = '/api/v1/identify'
export const SDK_KEY_HEADER = 'x-api-key'
const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key'

/** One signal that fired, and what it was worth. */
export interface SubmitTrigger {
  signal: string
  /** The card this signal is reported under, such as `vpn` for `vpn_public`. */
  group?: string
  /** The weight in force when this submission was scored, not the current one. */
  weight: number
  confidence?: string
  /** The tell that fired it, such as `known-tor-exit`. */
  reason?: string
}

/**
 * What the server sends back - the wire shape of `schemas.IdentifyOut`.
 *
 * Everything past `request_id` is optional here because the server omits an
 * empty value rather than sending a zero, and because a duplicate carries no
 * verdict at all. `Client.identify` turns this into the friendlier
 * [[IdentifyResult]]; this type exists so the raw answer is still reachable.
 */
export interface SubmitResponse {
  request_id: string
  /** Short-lived capability used only to attach the second-tier report. */
  deferred_token?: string

  /**
   * True when this submission was answered before, under the same idempotency
   * key.
   *
   * The verdict belongs to that first submission and is not repeated, so every
   * field below is absent. Without this flag the absence would read as "nobody
   * could be identified", which is a different answer entirely.
   */
  duplicate?: boolean

  /** Who this visitor is. Always present unless `duplicate`. */
  visitor_id?: string
  visitor_is_new?: boolean

  /**
   * False when the report carried too little to identify anyone - a hardened
   * browser, or a client that would rather not be recognised. The submission is
   * still answered and still scored, more highly in fact, and `visitor_id` is
   * minted rather than matched.
   */
  identifiable?: boolean

  /**
   * How sure the server is about `visitor_id`, from 0 to 100.
   *
   * 100 when this exact device has been seen before, 85-99 when it drifted and
   * was recognised by similarity, 0 when the identifier was minted because
   * nothing matched.
   */
  visitor_confidence?: number

  /** `enriched` or `unavailable`. */
  state?: string
  /** Why enrichment did not happen, as a short stable token. */
  reason?: string

  /**
   * The weighted sum of the signals that fired.
   *
   * Absent when the submission was not scored, which is a different answer from
   * zero: an ordinary visitor scores zero, and one whose enrichment never ran
   * has no score at all.
   */
  suspect_score?: number
  /** `low`, `medium` or `high`. Absent exactly when `suspect_score` is. */
  suspect_level?: string

  triggers?: SubmitTrigger[]
}

export interface Transport {
  /**
   * A custom HTTP implementation that retries must reuse one Idempotency-Key
   * for every attempt of this call and mint a new one for the next call.
   */
  submit(submission: IdentifySubmission, signal?: AbortSignal): Promise<SubmitResponse>
  submitSupplement?(
    requestId: string,
    submission: DeferredSubmission,
    signal?: AbortSignal,
  ): Promise<void>
}

/**
 * The failure a caller can actually act on.
 *
 * `status` is the HTTP status where there was one. The two worth branching on
 * are 401 (the key is wrong, or was presented from an origin it does not list)
 * and 402 (the organisation is not accepting traffic) - both are the customer's
 * configuration rather than the visitor's, and both are documented on the route.
 */
export class TransportError extends Error {
  override readonly name = 'TransportError'
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message)
  }
}

export interface HttpTransportOptions {
  /** The SDK key. A public key in a page, a secret key on a backend. */
  apiKey: string
  /** Origin of the API. Defaults to production. */
  endpoint?: string
  /** Ordered custom ingestion bases. Prefer this over endpoint. */
  endpoints?: string | readonly string[]
  /** Append the API-key-derived Fingerly data plane after custom endpoints. */
  fallbackToDefaultEndpoint?: boolean
  /** Total attempts, including the first. */
  maxAttempts?: number
  /** Per-attempt ceiling. The retry budget is this times `maxAttempts`. */
  requestTimeoutMs?: number
  /** Injected in tests and on platforms without a global `fetch`. */
  fetchImpl?: typeof fetch
}

/**
 * Which failures are worth trying again.
 *
 * 429 and 5xx are the server asking for patience. A 4xx that is not 429 is the
 * request being wrong, and repeating it only burns the visitor's battery and
 * the customer's rate limit - notably 401, where retrying a key that does not
 * match cannot make it match.
 */
function isRetryableStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)
}

function normalizeEndpoint(endpoint: string): string {
  const value = endpoint.trim()
  if (value === '' || value.includes('?') || value.includes('#')) {
    throw new TypeError('A Fingerly endpoint must be a non-empty base URL without a query or fragment')
  }
  if (!(value.startsWith('/') || /^https?:\/\//i.test(value))) {
    throw new TypeError('A Fingerly endpoint must be an absolute URL or a root-relative browser path')
  }
  return value.replace(/\/+$/, '')
}

/**
 * Exponential backoff with full jitter.
 *
 * Full jitter rather than a fixed multiplier because the failure this retry
 * path most often meets is a server under load, and a fleet of pages that all
 * back off by exactly 200ms then 400ms returns as a thundering herd on the
 * same two ticks. Randomising the whole interval spreads the retries out.
 */
function backoffMs(attempt: number, random: () => number): number {
  const ceiling = Math.min(2000, 100 * 2 ** (attempt - 1))
  return Math.floor(random() * ceiling)
}

/** A collision-resistant operation identifier; it is not a credential. */
function newIdempotencyKey(): string {
  const available = (globalThis as typeof globalThis & { crypto?: Crypto }).crypto
  if (typeof available?.randomUUID === 'function') return available.randomUUID()

  if (typeof available?.getRandomValues === 'function') {
    const bytes = available.getRandomValues(new Uint8Array(16))
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  // Idempotency keys are opaque correlators, not secrets. Keep old JS hosts
  // working when Web Crypto is absent instead of turning retry safety into a
  // reason the submission cannot be sent at all.
  return `fingerly-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

export class HttpTransport implements Transport {
  private readonly apiKey: string
  private readonly urls: readonly string[]
  private readonly maxAttempts: number
  private readonly requestTimeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: HttpTransportOptions) {
    if (!options.apiKey) {
      throw new TransportError('An SDK key is required to submit a fingerprint')
    }

    if (options.endpoint !== undefined && options.endpoints !== undefined) {
      throw new TypeError('Pass endpoints or the deprecated endpoint option, not both')
    }

    this.apiKey = options.apiKey
    const configured = options.endpoints ?? options.endpoint
    let bases = configured === undefined
      ? [defaultEndpointForKey(options.apiKey)]
      : (Array.isArray(configured) ? [...configured] : [configured as string])
    if (bases.length === 0) throw new TypeError('The endpoints array must not be empty')
    bases = bases.map(normalizeEndpoint)
    if (configured !== undefined && options.fallbackToDefaultEndpoint) {
      const direct = defaultEndpointForKey(options.apiKey)
      if (!bases.includes(direct)) bases.push(direct)
    }
    this.urls = bases.map((base) => base + IDENTIFY_PATH)
    this.maxAttempts = Math.max(1, this.urls.length, options.maxAttempts ?? 3)
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5000

    const impl = options.fetchImpl ?? globalThis.fetch
    if (typeof impl !== 'function') {
      throw new TransportError('No fetch implementation is available; pass one as fetchImpl')
    }
    // Bound because some environments - Safari among them - throw "Illegal
    // invocation" when `fetch` is called detached from its global.
    this.fetchImpl = impl.bind(globalThis)
  }

  async submit(submission: IdentifySubmission, signal?: AbortSignal): Promise<SubmitResponse> {
    let lastError: TransportError | undefined
    // Freeze both parts of the operation before the first attempt. A caller
    // mutating its object while a retry waits must not put two bodies under one
    // idempotency key.
    const body = JSON.stringify(submission)
    const idempotencyKey = newIdempotencyKey()

    let endpointIndex = 0
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (signal?.aborted) throw new TransportError('The submission was cancelled')

      try {
        return await this.attempt(this.urls[endpointIndex]!, body, idempotencyKey, signal)
      } catch (error) {
        const failure =
          error instanceof TransportError
            ? error
            : new TransportError(
                error instanceof Error ? error.message : 'The submission could not be sent',
                undefined,
                // A thrown fetch is a network failure - offline, DNS, a
                // connection reset - and those are exactly the ones worth
                // repeating.
                true,
              )

        if (!failure.retryable || attempt === this.maxAttempts) throw failure
        lastError = failure

        endpointIndex = Math.min(endpointIndex + 1, this.urls.length - 1)

        await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt, Math.random)))
      }
    }

    // Unreachable: the loop either returns or throws. Present so the function
    // has one exit type rather than an implicit undefined.
    throw lastError ?? new TransportError('The submission could not be sent')
  }

  async submitSupplement(
    requestId: string,
    submission: DeferredSubmission,
    signal?: AbortSignal,
  ): Promise<void> {
    const body = JSON.stringify(submission)
    let lastError: TransportError | undefined
    let endpointIndex = 0
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      // As in submit(): an abort listener added to a signal that has already
      // fired never runs, so without this a cancelled supplement would still
      // send its next attempt.
      if (signal?.aborted) throw new TransportError('The supplement was cancelled')

      try {
        const url = `${this.urls[endpointIndex]!.replace(/\/identify$/, '')}/events/${encodeURIComponent(requestId)}/supplement`
        await this.postJSON(url, body, signal)
        return
      } catch (error) {
        const failure = error instanceof TransportError
          ? error
          : new TransportError(error instanceof Error ? error.message : 'The supplement could not be sent', undefined, true)
        if (!failure.retryable || attempt === this.maxAttempts) throw failure
        lastError = failure
        endpointIndex = Math.min(endpointIndex + 1, this.urls.length - 1)
        await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt, Math.random)))
      }
    }
    throw lastError ?? new TransportError('The supplement could not be sent')
  }

  private async postJSON(
    url: string,
    body: string,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, this.requestTimeoutMs)
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [SDK_KEY_HEADER]: this.apiKey },
        body,
        credentials: 'omit',
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new TransportError(
          `The server refused the submission (${response.status})`,
          response.status,
          isRetryableStatus(response.status),
        )
      }
      return response
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  private async attempt(
    url: string,
    body: string,
    idempotencyKey: string,
    signal: AbortSignal | undefined,
  ): Promise<SubmitResponse> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, this.requestTimeoutMs)

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SDK_KEY_HEADER]: this.apiKey,
          [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
        },
        body,
        // No cookies. The SDK routes are served with `AllowCredentials: false`,
        // so a credentialed request would be refused by the browser before it
        // reached the server - and the key, not the session, is the identity
        // here in any case.
        credentials: 'omit',
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new TransportError(
          `The server refused the submission (${response.status})`,
          response.status,
          isRetryableStatus(response.status),
        )
      }

      const responseBody = (await response.json()) as Partial<SubmitResponse>
      if (typeof responseBody?.request_id !== 'string' || responseBody.request_id === '') {
        // A 2xx without an identifier means something answered that is not
        // this API - a captive portal or a proxy's error page. Not retryable:
        // it will answer the same way next time.
        throw new TransportError('The server accepted the submission but returned no request_id')
      }

      // Returned whole rather than picked apart. The fields this SDK does not
      // know about yet are the ones a server deployed ahead of it would be
      // adding, and dropping them here would mean an SDK upgrade for every one.
      return responseBody as SubmitResponse
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}
