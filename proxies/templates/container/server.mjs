/**
 * Fingerly first-party proxy as a small Node service, version 1.0.0.
 *
 * Your front proxy or load balancer routes the one path the Fingerly dashboard
 * issued (such as `/k7x2qm4a`) to this service, which forwards the browser
 * SDK's submissions to the Fingerly API. No dependencies: node:http and the
 * global fetch of Node 20 or later. The container and gcp-cloud-run templates
 * ship this same file; only PRESET differs.
 *
 * Environment:
 *   FINGERLY_PROXY_KEY         the `fly_px_...` key the dashboard issued, from
 *                              your secret store
 *   FINGERLY_PATH              the path the dashboard issued, such as `/k7x2qm4a`
 *   FINGERLY_CLIENT_IP_SOURCE  where the visitor's address comes from (PRESET
 *                              holds the default):
 *                                remote         the address of the connection
 *                                header:<name>  a single-value header your
 *                                               front proxy sets, overwriting
 *                                               whatever the visitor sent
 *                                xff:<n>        the n-th X-Forwarded-For entry
 *                                               from the right
 *   PORT                       the port to listen on (default 8080)
 */
import { createServer } from 'node:http'
import { isIP } from 'node:net'
import { pathToFileURL } from 'node:url'

/** This copy's kind, reported upstream, and its default client address source. */
const PRESET = { kind: 'container', clientIpSource: 'remote' }

const VERSION = '1.0.0'
const MAX_BODY_BYTES = 1_048_576
const UPSTREAM_TIMEOUT_MS = 5_000
/**
 * The one URL this service can reach. A constant rather than anything derived
 * from configuration: a misconfigured service must not be able to send your
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
function isProxyKey(key) {
  return /^fly_px_(?:production|staging|development)_[A-Za-z0-9_-]+$/.test(key)
}

/** Whether the request is for the one configured path. */
function isProxyPath(pathname, configured) {
  const path = configured.trim().replace(/\/+$/, '')
  return path.startsWith('/') && path.length > 1 && pathname.replace(/\/+$/, '') === path
}

function header(req, name) {
  const value = req.headers[name]
  return Array.isArray(value) ? value.join(', ') : value
}

/** An address as the API expects it, or '' when the source held none. */
function address(value) {
  const ip = (value ?? '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '')
  return isIP(ip) ? ip : ''
}

/**
 * How to read the visitor's address, from FINGERLY_CLIENT_IP_SOURCE. Only a
 * source the visitor cannot write is safe: the connection itself, a header
 * your front proxy overwrites, or an X-Forwarded-For position counted from the
 * right, past the entries your own proxies appended.
 */
export function clientIpReader(source) {
  if (source === 'remote') return (req) => address(req.socket.remoteAddress)
  const named = /^header:([A-Za-z0-9-]+)$/.exec(source)
  if (named) {
    const name = named[1].toLowerCase()
    // A repeated header arrives joined with commas: refuse it rather than guess.
    return (req) => {
      const value = header(req, name) ?? ''
      return value.includes(',') ? '' : address(value)
    }
  }
  const counted = /^xff:([1-9][0-9]?)$/.exec(source)
  if (counted) {
    const position = Number(counted[1])
    return (req) => {
      const entries = (header(req, 'x-forwarded-for') ?? '').split(',').map((entry) => entry.trim())
      return entries.length >= position ? address(entries[entries.length - position]) : ''
    }
  }
  throw new Error(`FINGERLY_CLIENT_IP_SOURCE must be remote, header:<name> or xff:<n>, not ${JSON.stringify(source)}`)
}

function plain(res, status, message, extra = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra })
  res.end(message)
}

/** Reads the body, or returns null once it passes the cap (draining the rest). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resolve(null)
        req.removeAllListeners('data')
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * The service, configured from the given environment. An unreadable
 * FINGERLY_CLIENT_IP_SOURCE throws here, at start-up, not on the first request.
 */
export function createRelay(env = process.env) {
  const clientIp = clientIpReader(env.FINGERLY_CLIENT_IP_SOURCE || PRESET.clientIpSource)
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://relay.invalid')
      if (!isProxyPath(url.pathname, env.FINGERLY_PATH ?? '')) return plain(res, 404, 'Not Found')
      if (req.method !== 'POST') return plain(res, 405, 'Method Not Allowed', { allow: 'POST' })

      const proxyKey = env.FINGERLY_PROXY_KEY ?? ''
      if (!isProxyKey(proxyKey)) return plain(res, 503, 'Service Unavailable')
      const publicKey = header(req, 'x-api-key')
      if (!publicKey) return plain(res, 401, 'Unauthorized')
      const declaredLength = Number(header(req, 'content-length') ?? '0')
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        // Drained, not read: closing mid-upload would cut the answer off.
        req.resume()
        return plain(res, 413, 'Payload Too Large')
      }
      const body = await readBody(req)
      if (body === null) return plain(res, 413, 'Payload Too Large')

      // Built from scratch: cookies, authorization and anything else the
      // visitor sent (including forged x-fingerly-* headers) never reach the API.
      const headers = new Headers({
        'content-type': header(req, 'content-type') ?? 'application/json',
        'x-api-key': publicKey,
        'x-fingerly-proxy-key': proxyKey,
        'x-fingerly-client-ip': clientIp(req),
        'x-fingerly-origin': header(req, 'origin') ?? `https://${header(req, 'host') ?? ''}`,
        'x-fingerly-user-agent': header(req, 'user-agent') ?? '',
        'x-fingerly-proxy-version': `${PRESET.kind}/${VERSION}`,
      })
      const idempotency = header(req, 'idempotency-key')
      if (idempotency) headers.set('idempotency-key', idempotency)

      let upstream
      try {
        upstream = await fetch(UPSTREAM, {
          method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        })
      } catch {
        return plain(res, 502, 'Bad Gateway')
      }

      const outgoing = { 'cache-control': 'no-store' }
      for (const name of RELAYED_HEADERS) {
        const value = upstream.headers.get(name)
        if (value !== null) outgoing[name] = value
      }
      const payload = Buffer.from(await upstream.arrayBuffer())
      res.writeHead(upstream.status, outgoing)
      res.end(payload)
    } catch {
      if (!res.headersSent) plain(res, 502, 'Bad Gateway')
      else res.destroy()
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let server
  try {
    server = createRelay()
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
  const port = Number(process.env.PORT) || 8080
  server.listen(port, () => console.log(`listening on ${port}`))
  // Containers stop with SIGTERM; finish what is in flight, then exit.
  process.on('SIGTERM', () => server.close(() => process.exit(0)))
}
