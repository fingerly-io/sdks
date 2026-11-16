/**
 * Getting a v3 submission to the server (`POST /api/v1/ingest`).
 *
 * Every request sends a valid `16..128`-char printable ASCII `Idempotency-Key`
 * and serializes `rawBody` once before the retry loop so retries transmit the
 * exact same `Idempotency-Key` and byte-identical `rawBody`.
 */

import { own, ownCopy } from './own.js'
import { validateApiVersion } from './routes.js'
import { DEFAULT_ENDPOINT } from './routing.js'
import type { IdentifySubmission, IdentifyTrigger, SuspectLevel } from './types.js'

export const SDK_KEY_HEADER = 'x-api-key'

/** What a credential reads as wherever an SDK object is printed or serialised. */
export const REDACTED = '[redacted]'
/** Node's custom-inspection hook, by its registered name so no Node import is needed. */
export const INSPECT = Symbol.for('nodejs.util.inspect.custom')
const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key'
const REQUEST_IN_PROGRESS_CODE = 'request_in_progress'
const DEFAULT_IN_PROGRESS_RETRY_MS = 1000

/**
 * What the server sends back - the wire shape of `schemas.IdentifyOut`.
 */
export interface SubmitResponse {
  request_id: string
  duplicate?: boolean
  visitor_id?: string
  visitor_is_new?: boolean
  identifiable?: boolean
  visitor_confidence?: number
  state?: string
  reason?: string
  suspect_score?: number | null
  suspect_level?: SuspectLevel | string | null
  triggers?: IdentifyTrigger[]
}

export interface Transport {
  /**
   * A custom HTTP implementation that retries must reuse one Idempotency-Key
   * for every attempt of this call and mint a new one for the next call.
   */
  submit(submission: IdentifySubmission, signal?: AbortSignal): Promise<SubmitResponse>
}

export class TransportError extends Error {
  override readonly name = 'TransportError'
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
    /** The server's error code, such as `consent_required` or `request_in_progress`. */
    readonly code?: string,
    /**
     * How long the server asked the caller to wait, from `Retry-After`, in
     * milliseconds.
     */
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

/** The most of a response this SDK reads: an answer is a few kilobytes. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/**
 * The longest `Retry-After` an identification waits out by itself (`2000ms`).
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

async function refusalCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } } | null
    const code = own(own(body, 'error'), 'code')
    return typeof code === 'string' && code !== '' ? code : undefined
  } catch {
    return undefined
  }
}

function isRetryableStatus(status: number, code: string | undefined): boolean {
  if (status === 409 && code === REQUEST_IN_PROGRESS_CODE) return true
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

function refusal(response: Response, code: string | undefined): TransportError {
  const parsedWait = retryAfterMs(response)
  const retryable = isRetryableStatus(response.status, code)
  const effectiveWait =
    response.status === 409 && code === REQUEST_IN_PROGRESS_CODE
      ? Math.min(MAX_RETRY_WAIT_MS, Math.max(0, parsedWait ?? DEFAULT_IN_PROGRESS_RETRY_MS))
      : parsedWait

  return new TransportError(
    `The server refused the submission (${response.status})`,
    response.status,
    retryable,
    code,
    effectiveWait,
  )
}

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
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw unreadable()
    return ownCopy(parsed as Partial<SubmitResponse>)
  } catch {
    throw unreadable()
  }
}

function retryDelay(failure: TransportError, attempt: number): number | null {
  const backoff = backoffMs(attempt, Math.random)
  if (failure.status === 409 && failure.code === REQUEST_IN_PROGRESS_CODE) {
    const base = Math.min(MAX_RETRY_WAIT_MS, Math.max(0, failure.retryAfterMs ?? DEFAULT_IN_PROGRESS_RETRY_MS))
    return Math.min(MAX_RETRY_WAIT_MS, base + backoff)
  }
  if (failure.retryAfterMs === undefined) return backoff
  if (failure.retryAfterMs > MAX_RETRY_WAIT_MS) return null
  return failure.retryAfterMs + backoff
}

export interface HttpTransportOptions {
  /** API route version. Defaults to v1. */
  apiVersion?: string
  /** The SDK key. A public key in a page, a secret key on a backend. */
  apiKey: string
  /**
   * Ordered custom ingestion URLs, each posted to exactly as given: a
   * root-relative path such as `/k7x2qm4a` for a first-party proxy on the
   * page's own site, or an absolute URL. A bare origin such as
   * `http://localhost:8099` is read as an API and gets the API's own path.
   */
  endpoints?: string | readonly string[]
  /** Append the Fingerly API after custom endpoints, as a last resort. */
  fallbackToDefaultEndpoint?: boolean
  /** Total attempts, including the first. */
  maxAttempts?: number
  /** Per-attempt ceiling. */
  requestTimeoutMs?: number
  /** Injected in tests and on platforms without a global `fetch`. */
  fetchImpl?: typeof fetch
}

function isMissingEndpoint(failure: TransportError): boolean {
  return failure.status === 404 || failure.status === 405
}

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
  return /^https?:\/\/[^/]+$/i.test(value) ? apiUrl(value, apiVersion) : value
}

function backoffMs(attempt: number, random: () => number): number {
  const ceiling = Math.min(2000, 100 * 2 ** (attempt - 1))
  return Math.floor(random() * ceiling)
}

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

function isValidIdempotencyKey(key: string): boolean {
  if (key.length < 16 || key.length > 128) return false
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i)
    if (code < 0x21 || code > 0x7e) return false
  }
  return true
}

/** The code of the error raised when no secure random source exists. */
export const NO_SECURE_RANDOM_CODE = 'no_secure_random'

/**
 * Generates a valid `16..128`-char printable ASCII `Idempotency-Key` from a
 * cryptographic generator. There is no fallback (`WEB-11`): a runtime without
 * `crypto.randomUUID` or `crypto.getRandomValues` fails the call before any
 * request is made, rather than sending a predictable key.
 */
function newIdempotencyKey(): string {
  const available = (globalThis as typeof globalThis & { crypto?: Crypto }).crypto
  if (typeof available?.randomUUID === 'function') {
    const uuid = available.randomUUID()
    if (isValidIdempotencyKey(uuid)) return uuid
  }

  if (typeof available?.getRandomValues === 'function') {
    const bytes = available.getRandomValues(new Uint8Array(16))
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  throw new TransportError(
    'No secure random source (crypto.getRandomValues) is available for the Idempotency-Key',
    undefined,
    false,
    NO_SECURE_RANDOM_CODE,
  )
}

export class HttpTransport implements Transport {
  readonly #apiKey: string
  private readonly urls: readonly string[]
  private readonly maxAttempts: number
  private readonly requestTimeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(input: HttpTransportOptions) {
    // Own properties only (`WEB-09`): a polluted `Object.prototype.endpoints`
    // must not choose where the report and the key are sent.
    const options = ownCopy(input) as HttpTransportOptions
    if (!options.apiKey) {
      throw new TransportError('An SDK key is required to submit a fingerprint')
    }

    this.#apiKey = options.apiKey
    const apiVersion = validateApiVersion(options.apiVersion)
    const configured = options.endpoints
    const listed =
      configured === undefined
        ? [defaultUrl(apiVersion)]
        : Array.isArray(configured)
          ? [...configured]
          : [configured as string]
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
    this.fetchImpl = impl.bind(globalThis)
  }

  toJSON(): Record<string, unknown> {
    return {
      apiKey: REDACTED,
      urls: [...this.urls],
      maxAttempts: this.maxAttempts,
      requestTimeoutMs: this.requestTimeoutMs,
    }
  }

  [INSPECT](): Record<string, unknown> {
    return this.toJSON()
  }

  async submit(submission: IdentifySubmission, signal?: AbortSignal): Promise<SubmitResponse> {
    let lastError: TransportError | undefined
    // Serialize rawBody once before the retry loop so every retry sends the
    // exact same Idempotency-Key and byte-identical rawBody.
    const rawBody = JSON.stringify(submission)
    const idempotencyKey = newIdempotencyKey()

    let endpointIndex = 0
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (signal?.aborted) throw new TransportError('The submission was cancelled')

      try {
        return await this.attempt(this.urls[endpointIndex]!, rawBody, idempotencyKey, signal)
      } catch (error) {
        const failure =
          error instanceof TransportError
            ? error
            : new TransportError(
                error instanceof Error ? error.message : 'The submission could not be sent',
                undefined,
                true,
              )

        const delay = this.nextAttempt(failure, attempt, endpointIndex)
        if (delay === null) throw failure
        lastError = failure

        if (!(failure.status === 409 && failure.code === REQUEST_IN_PROGRESS_CODE)) {
          endpointIndex = Math.min(endpointIndex + 1, this.urls.length - 1)
        }

        await waitBeforeRetry(delay, signal)
      }
    }

    throw lastError ?? new TransportError('The submission could not be sent')
  }

  private nextAttempt(failure: TransportError, attempt: number, endpointIndex: number): number | null {
    if (attempt === this.maxAttempts) return null
    if (failure.retryable) return retryDelay(failure, attempt)
    if (isMissingEndpoint(failure) && endpointIndex < this.urls.length - 1) return 0
    return null
  }

  private async attempt(
    url: string,
    rawBody: string,
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
        body: rawBody,
        credentials: 'omit',
        signal: controller.signal,
      })

      if (!response.ok) throw refusal(response, await refusalCode(response))

      const responseBody = await readAnswer(response)
      if (typeof responseBody?.request_id !== 'string' || responseBody.request_id === '') {
        throw new TransportError('The server accepted the submission but returned no request_id')
      }

      return responseBody as SubmitResponse
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}
