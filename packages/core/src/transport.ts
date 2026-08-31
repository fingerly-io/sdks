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

import type { IdentifySubmission } from './types.js'

export const IDENTIFY_PATH = '/api/v1/identify'
export const SDK_KEY_HEADER = 'x-api-key'

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
  submit(submission: IdentifySubmission, signal?: AbortSignal): Promise<SubmitResponse>
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
  /** Total attempts, including the first. */
  maxAttempts?: number
  /** Per-attempt ceiling. The retry budget is this times `maxAttempts`. */
  requestTimeoutMs?: number
  /** Injected in tests and on platforms without a global `fetch`. */
  fetchImpl?: typeof fetch
}

const DEFAULT_ENDPOINT = 'https://api.badele.io'

/**
 * Which failures are worth trying again.
 *
 * 429 and 5xx are the server asking for patience. A 4xx that is not 429 is the
 * request being wrong, and repeating it only burns the visitor's battery and
 * the customer's rate limit - notably 401, where retrying a key that does not
 * match cannot make it match.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
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

export class HttpTransport implements Transport {
  private readonly apiKey: string
  private readonly url: string
  private readonly maxAttempts: number
  private readonly requestTimeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: HttpTransportOptions) {
    if (!options.apiKey) {
      throw new TransportError('An SDK key is required to submit a fingerprint')
    }

    this.apiKey = options.apiKey
    this.url = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, '') + IDENTIFY_PATH
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3)
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

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (signal?.aborted) throw new TransportError('The submission was cancelled')

      try {
        return await this.attempt(submission, signal)
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

        await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt, Math.random)))
      }
    }

    // Unreachable: the loop either returns or throws. Present so the function
    // has one exit type rather than an implicit undefined.
    throw lastError ?? new TransportError('The submission could not be sent')
  }

  private async attempt(
    submission: IdentifySubmission,
    signal: AbortSignal | undefined,
  ): Promise<SubmitResponse> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, this.requestTimeoutMs)

    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SDK_KEY_HEADER]: this.apiKey,
        },
        body: JSON.stringify(submission),
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

      const body = (await response.json()) as Partial<SubmitResponse>
      if (typeof body?.request_id !== 'string' || body.request_id === '') {
        // A 2xx without an identifier means something answered that is not
        // this API - a captive portal or a proxy's error page. Not retryable:
        // it will answer the same way next time.
        throw new TransportError('The server accepted the submission but returned no request_id')
      }

      // Returned whole rather than picked apart. The fields this SDK does not
      // know about yet are the ones a server deployed ahead of it would be
      // adding, and dropping them here would mean an SDK upgrade for every one.
      return body as SubmitResponse
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}
