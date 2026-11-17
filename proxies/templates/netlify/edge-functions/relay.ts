/**
 * Fingerly first-party proxy as a Netlify Edge Function, version 1.0.0.
 *
 * Save this file as `netlify/edge-functions/relay.ts` and bind it to the one
 * path the Fingerly dashboard issued in netlify.toml (`/k7x2qm4a` below; the
 * netlify.toml path and PATH must both hold it). It forwards single-pass
 * browser and native SDK submissions as raw bytes to the Fingerly API. The
 * proxy key comes from the FINGERLY_PROXY_KEY environment variable. No
 * dependencies: web-standard Request and Response only.
 */

/** The two members of Netlify's context and global this function uses. */
interface Context { ip: string }
declare const Netlify: { env: { get(name: string): string | undefined } }

/** The path the dashboard issued. Keep it equal to the path in netlify.toml. */
const PATH = '/k7x2qm4a'
const VERSION = '1.0.0'
const MAX_BODY_BYTES = 1_048_576
const UPSTREAM_TIMEOUT_MS = 5_000
/**
 * The one URL this function can reach. A constant rather than anything derived
 * from configuration: a misconfigured site must not be able to send your
 * traffic somewhere else. Single-pass browser and native SDK submissions go
 * here as raw bytes.
 */
const UPSTREAM = 'https://api.fingerly.io/api/v1/ingest'

/** Exact lowercase platform names accepted on the native SDK channel. */
const SDK_PLATFORM_RE = /^(ios|android|react-native|react-native-ios|react-native-android|flutter|flutter-ios|flutter-android|lynx-ios|lynx-android|capacitor|kotlin-multiplatform)$/

/** Allowlisted client headers forwarded verbatim when present. */
const FORWARDED_CLIENT_HEADERS = [
  'idempotency-key',
  'user-agent',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
]

/**
 * The response headers relayed to the caller, and nothing else. A blocker can
 * match a response header by name, so an allowlist is what guarantees nothing
 * on the way back names Fingerly, whatever the API sends in future.
 */
const RELAYED_HEADERS = ['content-type', 'x-request-id', 'ratelimit-limit', 'ratelimit-remaining', 'retry-after']

/** Whether the configured value is shaped like a Fingerly proxy key. */
function isProxyKey(key: string): boolean {
  return /^fly_px_(?:production|staging|development)_[A-Za-z0-9_-]+$/.test(key)
}

/**
 * Whether the caller's X-Api-Key is a public key of the proxy key's
 * environment. Anything else, a secret `fly_sk_` key included, is answered 401
 * here rather than sent upstream.
 */
function isPublicKeyFor(proxyKey: string, publicKey: string | null): publicKey is string {
  const environment = /^fly_px_(production|staging|development)_/.exec(proxyKey)?.[1]
  return Boolean(environment) && new RegExp(`^fly_pk_${environment}_[A-Za-z0-9_-]+$`).test(publicKey ?? '')
}

/** Whether the request is for the one configured path. */
function isProxyPath(pathname: string): boolean {
  // Exactly: no trailing slash, nothing under it, case-sensitive.
  return pathname === PATH
}

/** Only a final answer in 200 to 599, outside 300 to 399, is relayed. */
function relayable(status: number): boolean {
  return status >= 200 && status <= 599 && (status < 300 || status > 399)
}

function plain(status: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra } })
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/** Whether the value is one IPv4 or IPv6 literal and nothing else. */
function isIpLiteral(value: string): boolean {
  if (IPV4.test(value)) return true
  if (!/^[0-9A-Fa-f:.]+$/.test(value) || !value.includes(':')) return false
  try {
    return new URL(`http://[${value}]/`).hostname.length > 2
  } catch {
    return false
  }
}

/** Reported once per instance rather than per request: it is configuration. */
let reportedMissingAddress = false

function noAddress(): Response {
  if (!reportedMissingAddress) {
    reportedMissingAddress = true
    console.error('proxy: the client IP callback returned no valid address; nothing was forwarded')
  }
  return plain(500, 'The client IP callback returned no valid address')
}

/** The most of an answer relayed: an answer is a few kilobytes. */
const MAX_RESPONSE_BYTES = 4 * 1_048_576

/** Reads a body to its end, or returns null once it passes `limit` bytes. */
async function readCapped(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export default async function relay(request: Request, context: Context): Promise<Response> {
  const url = new URL(request.url)
  if (!isProxyPath(url.pathname)) return plain(404, 'Not Found')
  if (request.method !== 'POST') return plain(405, 'Method Not Allowed', { allow: 'POST' })

  const proxyKey = Netlify.env.get('FINGERLY_PROXY_KEY') ?? ''
  if (!isProxyKey(proxyKey)) return plain(503, 'Service Unavailable')

  // 1. Capture validated lowercase x-fingerly-sdk-platform; anything else is discarded.
  const rawPlatform = request.headers.get('x-fingerly-sdk-platform') ?? ''
  const sdkPlatform = SDK_PLATFORM_RE.test(rawPlatform) ? rawPlatform : ''
  const origin = request.headers.get('origin') ?? ''
  // 2-4. Reject with 400 missing_origin iff both Origin and validated sdkPlatform are empty.
  if (!origin && !sdkPlatform) {
    return jsonError(400, 'missing_origin', 'Origin or X-Fingerly-SDK-Platform header is required')
  }

  const publicKey = request.headers.get('x-api-key')
  if (!isPublicKeyFor(proxyKey, publicKey)) return plain(401, 'Unauthorized')
  const visitorIp = (context.ip ?? '').trim()
  if (!isIpLiteral(visitorIp)) return noAddress()
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return plain(413, 'Payload Too Large')
  const body = await readCapped(request.body, MAX_BODY_BYTES)
  if (body === null) return plain(413, 'Payload Too Large')

  // Built from scratch: cookies, authorization and anything else the visitor
  // sent (including forged x-fingerly-* headers) never reach the API.
  const headers = new Headers({
    'content-type': request.headers.get('content-type') ?? 'application/json',
    'x-api-key': publicKey,
    'x-fingerly-proxy-key': proxyKey,
    // The address Netlify's edge accepted the connection from, not a header.
    'x-fingerly-client-ip': visitorIp,
    'x-fingerly-user-agent': request.headers.get('user-agent') ?? '',
    'x-fingerly-proxy-version': `netlify/${VERSION}`,
  })
  // One channel only: a browser Origin wins over a platform claim, as on the
  // API, which refuses a proxied request carrying both.
  if (origin) headers.set('x-fingerly-origin', origin)
  else if (sdkPlatform) headers.set('x-fingerly-sdk-platform', sdkPlatform)
  const host = request.headers.get('host') || url.host
  if (host) headers.set('x-fingerly-host', host)
  for (const name of FORWARDED_CLIENT_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  // One deadline for the whole exchange, ended early if the visitor goes away.
  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  const signal = typeof AbortSignal.any === 'function' ? AbortSignal.any([timeout, request.signal]) : timeout
  let upstream: Response
  let answer: Uint8Array | null
  try {
    upstream = await fetch(UPSTREAM, { method: 'POST', headers, body, redirect: 'manual', signal })
    // A redirect is never followed or relayed, and neither is a status
    // outside 200 to 599: the key went to the pinned URL only. An opaque
    // redirect has status 0, so it is caught here too.
    if (!relayable(upstream.status) || upstream.redirected) {
      upstream.body?.cancel().catch(() => {})
      console.warn('proxy: upstream answered with an unusable status')
      return plain(502, 'Bad gateway')
    }
    // Read whole, under the same deadline, before anything is sent back: a
    // truncated answer relayed with a 200 would be read as a success.
    answer = await readCapped(upstream.body, MAX_RESPONSE_BYTES)
  } catch {
    if (request.signal.aborted) return plain(499, '')
    const timedOut = timeout.aborted
    console.warn(timedOut ? 'proxy: upstream timed out' : 'proxy: upstream unreachable')
    return timedOut ? plain(504, 'Gateway timeout') : plain(502, 'Bad gateway')
  }
  if (answer === null) {
    console.warn('proxy: upstream answer over the size limit')
    return plain(502, 'Bad gateway')
  }

  const outgoing = new Headers({ 'cache-control': 'no-store' })
  for (const name of RELAYED_HEADERS) {
    const value = upstream.headers.get(name)
    if (value !== null) outgoing.set(name, value)
  }
  const bodiless = upstream.status === 204 || upstream.status === 205
  return new Response(bodiless ? null : answer, { status: upstream.status, statusText: upstream.statusText, headers: outgoing })
}
