import { createHmac, timingSafeEqual } from 'node:crypto'

const endpointForKey = (key: string): string => {
  const match = /^fly_(?:pk|sk|px)_(eu|us)_(?:production|staging|development)_/.exec(key)
  return match?.[1] === 'us'
    ? 'https://us.api.fingerly.io'
    : match?.[1] === 'eu'
      ? 'https://eu.api.fingerly.io'
      : 'https://api.fingerly.io'
}

export interface EventTrigger { signal: string; weight: number; confidence?: string }
export interface Event {
  request_id: string
  visitor_id: string
  occurred_at: string
  state: string
  environment: string
  platform: string
  sdk_platform: string
  sdk_version: string
  origin?: string
  url_host?: string
  url_path?: string
  tag?: string
  ip_address: string
  country_code?: string
  country_name?: string
  asn?: string
  asn_name?: string
  anonymity_network?: string
  agent?: string
  agent_version?: string
  os?: string
  device_kind?: string
  visitor_kind?: string
  suspect_score: number | null
  suspect_level?: string
  triggers: EventTrigger[]
  has_document: boolean
  document?: unknown
  deferred_signals?: Record<string, unknown>
}

export interface EventListOptions {
  from?: Date | string
  to?: Date | string
  page?: number
  limit?: number
  visitor?: string
  level?: 'low' | 'medium' | 'high'
  signal?: AbortSignal
}
export interface EventPage { rows: Event[]; page: number; page_size: number }
export interface FingerlyOptions { secretKey: string; endpoint?: string; fetchImpl?: typeof fetch }

export class FingerlyAPIError extends Error {
  override readonly name = 'FingerlyAPIError'
  constructor(message: string, readonly status: number) { super(message) }
}

function instant(value: Date | string): string { return value instanceof Date ? value.toISOString() : value }

export function load(options: FingerlyOptions) {
  if (!options.secretKey) throw new TypeError('A Fingerly secret key is required')
  const endpoint = (options.endpoint ?? endpointForKey(options.secretKey)).replace(/\/+$/, '')
  const request = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
    const response = await (options.fetchImpl ?? globalThis.fetch)(endpoint + path, {
      headers: { 'x-api-key': options.secretKey, accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) throw new FingerlyAPIError(`Fingerly API returned HTTP ${response.status}`, response.status)
    return response.json() as Promise<T>
  }
  return {
    events: {
      list: (query: EventListOptions = {}) => {
        const params = new URLSearchParams()
        if (query.from !== undefined) params.set('from', instant(query.from))
        if (query.to !== undefined) params.set('to', instant(query.to))
        if (query.page !== undefined) params.set('page', String(query.page))
        if (query.limit !== undefined) params.set('limit', String(query.limit))
        if (query.visitor !== undefined) params.set('visitor', query.visitor)
        if (query.level !== undefined) params.set('level', query.level)
        const suffix = params.size === 0 ? '' : `?${params}`
        return request<EventPage>(`/api/v1/events${suffix}`, query.signal)
      },
      get: (requestId: string, signal?: AbortSignal) => request<Event>(`/api/v1/events/${encodeURIComponent(requestId)}`, signal),
    },
  }
}

export interface VerifyWebhookOptions {
  secret: string
  payload: string | Uint8Array
  signature: string | null | undefined
  timestamp: string | null | undefined
  toleranceSeconds?: number
  now?: Date
}

/**
 * Verify the raw request body before parsing it.
 *
 * While an endpoint's secret is being rotated the signature header carries one
 * signature per secret, comma-separated, and a match on any of them is valid.
 */
export function verifyWebhook(options: VerifyWebhookOptions): boolean {
  const tolerance = options.toleranceSeconds ?? 300
  const seconds = Number(options.timestamp)
  if (!options.secret || !options.signature || !Number.isSafeInteger(seconds)) return false
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000)
  if (Math.abs(now - seconds) > tolerance) return false
  const body = Buffer.from(options.payload)
  const expected = Buffer.from(createHmac('sha256', options.secret).update(`${options.timestamp}.`).update(body).digest('hex'))
  return options.signature.split(',').some((candidate) => {
    const value = candidate.trim()
    if (!value.startsWith('sha256=')) return false
    const actual = Buffer.from(value.slice('sha256='.length))
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  })
}

export interface ProxyOptions {
  /** Write-only credential created for customer-owned proxy infrastructure. */
  proxyKey?: string
  /** @deprecated Use proxyKey. Secret read keys will be refused in the next major version. */
  secretKey?: string
  upstream?: string
  prefix?: string
  maxBodyBytes?: number
  timeoutMs?: number
  /** Resolve the visitor address only from infrastructure your app trusts. */
  clientIp(request: Request): string | Promise<string>
  fetchImpl?: typeof fetch
}

/** Framework-neutral same-origin proxy for identify and supplement POSTs. */
export function createProxy(options: ProxyOptions): (request: Request) => Promise<Response> {
  if (!options.proxyKey && !options.secretKey) throw new TypeError('A Fingerly proxy key is required')
  if (options.proxyKey && options.secretKey) throw new TypeError('Pass proxyKey or deprecated secretKey, not both')
  const credential = options.proxyKey ?? options.secretKey!
  const upstream = (options.upstream ?? endpointForKey(credential)).replace(/\/+$/, '')
  const prefix = (options.prefix ?? '/api/fingerly').replace(/\/+$/, '')
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576
  const timeoutMs = options.timeoutMs ?? 5_000
  return async (request: Request) => {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } })
    const incoming = new URL(request.url)
    if (!incoming.pathname.startsWith(prefix + '/api/v1/')) return new Response('Not Found', { status: 404 })
    const tail = incoming.pathname.slice(prefix.length)
    if (tail !== '/api/v1/identify' && !/^\/api\/v1\/events\/[^/]+\/supplement$/.test(tail)) return new Response('Not Found', { status: 404 })
    const publicKey = request.headers.get('x-api-key')
    if (options.proxyKey && !publicKey) return new Response('Unauthorized', { status: 401 })
    const body = await request.arrayBuffer()
    if (body.byteLength > maxBodyBytes) return new Response('Payload Too Large', { status: 413 })
    const headers = new Headers({
      'content-type': request.headers.get('content-type') ?? 'application/json',
      'x-api-key': options.proxyKey ? publicKey! : credential,
      'x-fingerly-client-ip': await options.clientIp(request),
      'x-fingerly-origin': request.headers.get('origin') ?? incoming.origin,
      'x-fingerly-user-agent': request.headers.get('user-agent') ?? '',
    })
    if (options.proxyKey) headers.set('x-fingerly-proxy-key', options.proxyKey)
    const idempotency = request.headers.get('idempotency-key')
    if (idempotency) headers.set('idempotency-key', idempotency)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await (options.fetchImpl ?? globalThis.fetch)(upstream + tail, {
        method: 'POST', headers, body, redirect: 'manual', signal: controller.signal,
      })
      const responseHeaders = new Headers(response.headers)
      responseHeaders.set('cache-control', 'no-store')
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders })
    } finally {
      clearTimeout(timer)
    }
  }
}
