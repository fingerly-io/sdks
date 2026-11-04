/**
 * Fingerly first-party proxy as a Netlify Edge Function, version 1.0.0.
 *
 * Save this file as `netlify/edge-functions/relay.ts` and bind it to the one
 * path the Fingerly dashboard issued in netlify.toml (`/k7x2qm4a` below; the
 * netlify.toml path and PATH must both hold it). It forwards the browser SDK's
 * submissions to the Fingerly API. The proxy key comes from the
 * FINGERLY_PROXY_KEY environment variable. No dependencies: web-standard
 * Request and Response only.
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
 * traffic somewhere else. Both of the browser SDK's calls go here; the API
 * tells them apart by their bodies.
 */
const UPSTREAM = 'https://api.fingerly.io/api/v1/ingest'

/**
 * The response headers relayed to the page, and nothing else. A blocker can
 * match a response header by name, so an allowlist is what guarantees nothing
 * on the way back names Fingerly, whatever the API sends in future.
 */
const RELAYED_HEADERS = ['content-type', 'x-request-id', 'ratelimit-limit', 'ratelimit-remaining', 'retry-after']

/** Whether the configured value is shaped like a Fingerly proxy key. */
function isProxyKey(key: string): boolean {
  return /^fly_px_(?:production|staging|development)_[A-Za-z0-9_-]+$/.test(key)
}

/** Whether the request is for the one configured path. */
function isProxyPath(pathname: string): boolean {
  // Exactly: no trailing slash, nothing under it, case-sensitive.
  return pathname === PATH
}

function plain(status: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra } })
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
  const publicKey = request.headers.get('x-api-key')
  if (!publicKey) return plain(401, 'Unauthorized')
  const visitorIp = (context.ip ?? '').trim()
  if (!isIpLiteral(visitorIp)) return noAddress()
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return plain(413, 'Payload Too Large')
  const body = await request.arrayBuffer()
  if (body.byteLength > MAX_BODY_BYTES) return plain(413, 'Payload Too Large')

  // Built from scratch: cookies, authorization and anything else the visitor
  // sent (including forged x-fingerly-* headers) never reach the API.
  const headers = new Headers({
    'content-type': request.headers.get('content-type') ?? 'application/json',
    'x-api-key': publicKey,
    'x-fingerly-proxy-key': proxyKey,
    // The address Netlify's edge accepted the connection from, not a header.
    'x-fingerly-client-ip': visitorIp,
    'x-fingerly-origin': request.headers.get('origin') ?? url.origin,
    'x-fingerly-user-agent': request.headers.get('user-agent') ?? '',
    'x-fingerly-proxy-version': `netlify/${VERSION}`,
  })
  const idempotency = request.headers.get('idempotency-key')
  if (idempotency) headers.set('idempotency-key', idempotency)

  // One deadline for the whole exchange, ended early if the visitor goes away.
  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  const signal = typeof AbortSignal.any === 'function' ? AbortSignal.any([timeout, request.signal]) : timeout
  let upstream: Response
  let answer: Uint8Array | null
  try {
    upstream = await fetch(UPSTREAM, { method: 'POST', headers, body, redirect: 'manual', signal })
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
  const bodiless = [204, 205, 304].includes(upstream.status)
  return new Response(bodiless ? null : answer, { status: upstream.status, statusText: upstream.statusText, headers: outgoing })
}
