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
  return new Response(message, { status, headers: { 'cache-control': 'no-store', ...extra } })
}

export default async function relay(request: Request, context: Context): Promise<Response> {
  const url = new URL(request.url)
  if (!isProxyPath(url.pathname)) return plain(404, 'Not Found')
  if (request.method !== 'POST') return plain(405, 'Method Not Allowed', { allow: 'POST' })

  const proxyKey = Netlify.env.get('FINGERLY_PROXY_KEY') ?? ''
  if (!isProxyKey(proxyKey)) return plain(503, 'Service Unavailable')
  const publicKey = request.headers.get('x-api-key')
  if (!publicKey) return plain(401, 'Unauthorized')
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
    'x-fingerly-client-ip': context.ip,
    'x-fingerly-origin': request.headers.get('origin') ?? url.origin,
    'x-fingerly-user-agent': request.headers.get('user-agent') ?? '',
    'x-fingerly-proxy-version': `netlify/${VERSION}`,
  })
  const idempotency = request.headers.get('idempotency-key')
  if (idempotency) headers.set('idempotency-key', idempotency)

  let upstream: Response
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch {
    return plain(502, 'Bad Gateway')
  }

  const outgoing = new Headers({ 'cache-control': 'no-store' })
  for (const name of RELAYED_HEADERS) {
    const value = upstream.headers.get(name)
    if (value !== null) outgoing.set(name, value)
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outgoing })
}
