/**
 * Getting a submission to the server.
 *
 * The route is `POST /api/v1/identify`, authenticated by an SDK key in
 * `x-api-key` and answering `202 Accepted` with a request identifier. See
 * `server/routers/sdk.go` for the registration and `server/app/app.go` for the
 * cross-origin policy that lets a browser read the answer.
 */

import type { IdentifySubmission } from './types.js'

export const IDENTIFY_PATH = '/api/v1/identify'
export const SDK_KEY_HEADER = 'x-api-key'

/**
 * What the server sends back. Only an identifier - see `schemas.IdentifyOut`.
 */
export interface SubmitResponse {
  request_id: string
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

      return { request_id: body.request_id }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}
