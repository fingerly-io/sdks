/**
 * Getting a submission to the server.
 *
 * Both calls - the identification and the deferred report after it - are one
 * `POST` to one URL, authenticated by an SDK key in `x-api-key`. Without custom
 * endpoints that URL is `https://api.fingerly.io/api/v1/ingest`; see
 * `server/handlers/ingest.go`, which tells the two apart by the deferred
 * report's `token`, and `server/app/app.go` for the cross-origin policy that
 * lets a browser read the answer.
 *
 * A custom endpoint is used exactly as given, with nothing appended, unless it
 * is a bare origin, which names an API rather than a proxy. That is the point:
 * a content blocker matches URLs, and a path added to every customer's proxy
 * is a path one generic rule could match on all of them. A first-party proxy
 * at an opaque path of the customer's own has nothing in common with any
 * other site's.
 */

import { validateApiVersion } from './routes.js'
import { DEFAULT_ENDPOINT } from './routing.js'
import type { DeferredSubmission, IdentifySubmission } from './types.js'

export const SDK_KEY_HEADER = 'x-api-key'

/** What a credential reads as wherever an SDK object is printed or serialised. */
export const REDACTED = '[redacted]'
/** Node's custom-inspection hook, by its registered name so no Node import is needed. */
export const INSPECT = Symbol.for('nodejs.util.inspect.custom')
const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key'

/** One signal that fired. The server no longer sends a weight to a browser. */
export interface SubmitTrigger {
  signal: string
  /** The card this signal is reported under, such as `vpn` for `vpn_public`. */
  group?: string
  /** @deprecated Only a secret-key backend is told this. A browser's answer does not carry it. */
  weight?: number
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
  /**
   * Why enrichment did not happen, as a short stable token. Answered to a
   * secret key only, so absent for this SDK and not read from the wire.
   */
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
    /** The server's error code, such as `consent_required`, when it sent one. */
    readonly code?: string,
    /**
     * How long the server asked the caller to wait, from `Retry-After`, in
     * milliseconds. Present on a 429 or 503 that said; absent otherwise.
     */
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

/** The most of a response this SDK reads: an answer is a few kilobytes. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/**
 * The longest `Retry-After` an identification waits out by itself. Longer
 * than this and the visitor is better served by the page deciding, so the
 * refusal is returned with `retryAfterMs` instead of being retried.
 */
const MAX_RETRY_WAIT_MS = 2000

/** `Retry-After` as delta-seconds or an HTTP date, in milliseconds. */
function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('retry-after')?.trim()
  if (!value) return undefined
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined
}

/**
 * The `error.code` of a refusal, when the body is the API's error envelope.
 *
 * Best effort: a refusal from a proxy or a captive portal is not JSON, and its
 * status is still the useful part.
 */
async function refusalCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } } | null
    const code = body?.error?.code
    return typeof code === 'string' && code !== '' ? code : undefined
  } catch {
    return undefined
  }
}

function refusal(response: Response, code: string | undefined): TransportError {
  return new TransportError(
    `The server refused the submission (${response.status})`,
    response.status,
    isRetryableStatus(response.status),
    code,
    retryAfterMs(response),
  )
}

/**
 * Reads a successful answer, refusing anything that is not this API's JSON.
 *
 * Never retried: a captive portal or a proxy error page answers the same way
 * the next time. The message never quotes the body, which is whatever that
 * page happened to send.
 */
async function readAnswer(response: Response): Promise<Partial<SubmitResponse>> {
  const unreadable = () =>
    new TransportError('The server answered with a response this SDK cannot read', response.status, false)
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined)
    throw unreadable()
  }
  const text = await response.text()
  if (text.length > MAX_RESPONSE_BYTES) throw unreadable()
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') throw unreadable()
    return parsed as Partial<SubmitResponse>
  } catch {
    throw unreadable()
  }
}

/**
 * How long to wait before the next attempt, or null when there should be none.
 *
 * A `Retry-After` is honoured when it is short, and ends the call when it is
 * long: retrying sooner than the server asked only earns another 429, and
 * every one of them counts against the customer's rate limit.
 */
function retryDelay(failure: TransportError, attempt: number): number | null {
  const backoff = backoffMs(attempt, Math.random)
  if (failure.retryAfterMs === undefined) return backoff
  if (failure.retryAfterMs > MAX_RETRY_WAIT_MS) return null
  // On top of the wait, not instead of it: every page told "1 second" by the
  // same limiter would otherwise come back on the same tick.
  return failure.retryAfterMs + backoff
}

export interface HttpTransportOptions {
  /** API route version. Defaults to v1. */
  apiVersion?: string
  /** The SDK key. A public key in a page, a secret key on a backend. */
  apiKey: string
  /** @deprecated One custom endpoint. Use `endpoints`, which means the same. */
  endpoint?: string
  /**
   * Ordered custom ingestion URLs, each posted to exactly as given: a
   * root-relative path such as `/k7x2qm4a` for a first-party proxy on the
   * page's own site, or an absolute URL. A bare origin such as
   * `http://localhost:8099` is read as an API and gets the API's own path.
   * Later ones are tried when an earlier one fails.
   */
  endpoints?: string | readonly string[]
  /** Append the Fingerly API after custom endpoints, as a last resort. */
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
 * 408, 429 and 5xx are the server asking for patience. Any other 4xx is the
 * request being wrong, and repeating it only burns the visitor's battery and
 * the customer's rate limit - notably 401, where retrying a key that does not
 * match cannot make it match.
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

/**
 * A 404 or 405 from one configured endpoint says that endpoint is not there,
 * which is a reason to try the next one in the list, and no reason to ask the
 * same one again.
 */
function isMissingEndpoint(failure: TransportError): boolean {
  return failure.status === 404 || failure.status === 405
}

/** An API's own URL for both calls, from its origin. */
function apiUrl(origin: string, apiVersion: string): string {
  return `${origin}/api/${apiVersion}/ingest`
}

function defaultUrl(apiVersion: string): string {
  return apiUrl(DEFAULT_ENDPOINT, apiVersion)
}

function normalizeEndpoint(endpoint: string, apiVersion: string): string {
  const value = endpoint.trim().replace(/\/+$/, '')
  if (value === '' || value.includes('?') || value.includes('#')) {
    throw new TypeError('A Fingerly endpoint must be a non-empty URL or path without a query or fragment')
  }
  if (!(value.startsWith('/') || /^https?:\/\//i.test(value))) {
    throw new TypeError('A Fingerly endpoint must be an absolute URL or a root-relative browser path')
  }
  // A bare origin names an API - ours, or one running locally - rather than a
  // proxy, which always sits at a path on the customer's site. The API's URL
  // for both calls is under it; posting to its root would be a 404 nobody meant.
  return /^https?:\/\/[^/]+$/i.test(value) ? apiUrl(value, apiVersion) : value
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

/**
 * The wait between attempts, cut short when the call is cancelled.
 *
 * A plain timer here kept a cancelled call - consent withdrawn, or the
 * caller's signal - pending for the whole wait, up to 2 s plus jitter after a
 * Retry-After, before the loop noticed the abort and rejected.
 */
function waitBeforeRetry(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
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
  /** Kept out of enumeration, JSON and inspection; see [[redacted]]. */
  readonly #apiKey: string
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

    this.#apiKey = options.apiKey
    const apiVersion = validateApiVersion(options.apiVersion)
    const configured = options.endpoints ?? options.endpoint
    const listed = configured === undefined
      ? [defaultUrl(apiVersion)]
      : (Array.isArray(configured) ? [...configured] : [configured as string])
    if (listed.length === 0) throw new TypeError('The endpoints array must not be empty')
    const urls = listed.map((endpoint) => normalizeEndpoint(endpoint, apiVersion))
    if (configured !== undefined && options.fallbackToDefaultEndpoint) {
      if (!urls.includes(defaultUrl(apiVersion))) urls.push(defaultUrl(apiVersion))
    }
    this.urls = urls
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

  /** What `JSON.stringify` shows: the endpoints, never the key. */
  toJSON(): Record<string, unknown> {
    return { apiKey: REDACTED, urls: [...this.urls], maxAttempts: this.maxAttempts, requestTimeoutMs: this.requestTimeoutMs }
  }

  /** What Node's `util.inspect` and `console.log` show. */
  [INSPECT](): Record<string, unknown> {
    return this.toJSON()
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

        const delay = this.nextAttempt(failure, attempt, endpointIndex)
        if (delay === null) throw failure
        lastError = failure

        endpointIndex = Math.min(endpointIndex + 1, this.urls.length - 1)

        await waitBeforeRetry(delay, signal)
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
        // The same URL as the identification. The token in the body names the
        // request, so nothing about this call shows in the URL.
        await this.postJSON(this.urls[endpointIndex]!, body, signal)
        return
      } catch (error) {
        const failure = error instanceof TransportError
          ? error
          : new TransportError(error instanceof Error ? error.message : 'The supplement could not be sent', undefined, true)
        const delay = this.nextAttempt(failure, attempt, endpointIndex)
        if (delay === null) throw failure
        lastError = failure
        endpointIndex = Math.min(endpointIndex + 1, this.urls.length - 1)
        await waitBeforeRetry(delay, signal)
      }
    }
    throw lastError ?? new TransportError('The supplement could not be sent')
  }

  /** The wait before another attempt after `failure`, or null for none. */
  private nextAttempt(failure: TransportError, attempt: number, endpointIndex: number): number | null {
    if (attempt === this.maxAttempts) return null
    if (failure.retryable) return retryDelay(failure, attempt)
    // Only onwards to another endpoint, and only once per endpoint.
    if (isMissingEndpoint(failure) && endpointIndex < this.urls.length - 1) return 0
    return null
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
        headers: { 'content-type': 'application/json', [SDK_KEY_HEADER]: this.#apiKey },
        body,
        credentials: 'omit',
        signal: controller.signal,
      })
      if (!response.ok) throw refusal(response, await refusalCode(response))
      // Read to the end even though nothing in it is needed: an unread body
      // keeps its loader alive in Chromium for the life of the page, about
      // 7 KB per identification in a long-lived single-page app.
      await response.arrayBuffer().catch(() => undefined)
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
          [SDK_KEY_HEADER]: this.#apiKey,
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

      if (!response.ok) throw refusal(response, await refusalCode(response))

      const responseBody = await readAnswer(response)
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
