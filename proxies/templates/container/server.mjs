/**
 * Fingerly first-party proxy as a small Node service, version 1.0.0.
 *
 * Your front proxy or load balancer routes the one path the Fingerly dashboard
 * issued (such as `/k7x2qm4a`) to this service, which forwards single-pass
 * browser and native SDK submissions as raw bytes to the Fingerly API. No
 * dependencies: node:http and the global fetch of Node 20 or later. The
 * container and gcp-cloud-run templates ship this same file; only PRESET
 * differs.
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
 * Web Bot Auth headers an AI agent's browser signs the request with, forwarded
 * when present and at most 4096 bytes. The API ignores a longer one, so it is
 * dropped here rather than refused.
 */
const SIGNATURE_HEADERS = ['signature', 'signature-input', 'signature-agent']
const MAX_SIGNATURE_HEADER_BYTES = 4096

/**
 * The response headers relayed to the caller, and nothing else. A blocker can
 * match a response header by name, so an allowlist is what guarantees nothing
 * on the way back names Fingerly, whatever the API sends in future.
 */
const RELAYED_HEADERS = ['content-type', 'x-request-id', 'ratelimit-limit', 'ratelimit-remaining', 'retry-after']

/** Whether the configured value is shaped like a Fingerly proxy key. */
function isProxyKey(key) {
  return /^fly_px_(?:production|staging|development)_[A-Za-z0-9_-]+$/.test(key)
}

/**
 * Whether the caller's X-Api-Key is a public key of the proxy key's
 * environment. Anything else, a secret `fly_sk_` key included, is answered 401
 * here rather than sent upstream.
 */
function isPublicKeyFor(proxyKey, publicKey) {
  const environment = /^fly_px_(production|staging|development)_/.exec(proxyKey)?.[1]
  return Boolean(environment) && new RegExp(`^fly_pk_${environment}_[A-Za-z0-9_-]+$`).test(publicKey ?? '')
}

/**
 * Whether the request target is for the one configured path. The raw target
 * is compared, before any URL parsing could resolve dot segments, merge
 * slashes or decode characters into the path: exactly the path, then nothing
 * or a query string. No trailing slash, nothing under it, case-sensitive.
 */
function isProxyPath(target, configured) {
  const path = configured.trim().replace(/\/+$/, '')
  if (!path.startsWith('/') || path.length < 2) return false
  const end = target.indexOf('?')
  return (end === -1 ? target : target.slice(0, end)) === path
}

function header(req, name) {
  const value = req.headers[name]
  return Array.isArray(value) ? value.join(', ') : value
}

/** An address as the API expects it, or '' when the source held none. */
function address(value) {
  const ip = (value ?? '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '')
  return !ip.includes('%') && isIP(ip) ? ip : ''
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

/** Reported once per process rather than per request: it is configuration. */
let reportedMissingAddress = false

/** Only a final answer in 200 to 599, outside 300 to 399, is relayed. */
function relayable(status) {
  return status >= 200 && status <= 599 && (status < 300 || status > 399)
}

function plain(res, status, message, extra = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra })
  res.end(message)
}

function jsonError(res, status, code, message) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ error: { code, message } }))
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

/** The most of an answer relayed: an answer is a few kilobytes. */
const MAX_RESPONSE_BYTES = 4 * 1_048_576

/** Reads a web stream to its end, or returns null once it passes `limit` bytes. */
async function readCapped(body, limit) {
  if (!body) return Buffer.alloc(0)
  const chunks = []
  let size = 0
  for await (const chunk of body) {
    size += chunk.byteLength
    if (size > limit) {
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * The service, configured from the given environment. An unreadable
 * FINGERLY_CLIENT_IP_SOURCE throws here, at start-up, not on the first request.
 */
export function createRelay(env = process.env) {
  const clientIp = clientIpReader(env.FINGERLY_CLIENT_IP_SOURCE || PRESET.clientIpSource)
  return createServer(async (req, res) => {
    try {
      if (!isProxyPath(req.url ?? '', env.FINGERLY_PATH ?? '')) return plain(res, 404, 'Not Found')
      if (req.method !== 'POST') return plain(res, 405, 'Method Not Allowed', { allow: 'POST' })

      const proxyKey = env.FINGERLY_PROXY_KEY ?? ''
      if (!isProxyKey(proxyKey)) {
        req.resume()
        return plain(res, 503, 'Service Unavailable')
      }

      // 1. Capture validated lowercase x-fingerly-sdk-platform; anything else is discarded.
      const rawPlatform = header(req, 'x-fingerly-sdk-platform') ?? ''
      const sdkPlatform = SDK_PLATFORM_RE.test(rawPlatform) ? rawPlatform : ''
      const origin = header(req, 'origin') ?? ''
      // 2-4. Reject with 400 missing_origin iff both Origin and validated sdkPlatform are empty.
      if (!origin && !sdkPlatform) {
        req.resume()
        return jsonError(res, 400, 'missing_origin', 'Origin or X-Fingerly-SDK-Platform header is required')
      }

      const publicKey = header(req, 'x-api-key')
      if (!isPublicKeyFor(proxyKey, publicKey)) {
        req.resume()
        return plain(res, 401, 'Unauthorized')
      }
      const declaredLength = Number(header(req, 'content-length') ?? '0')
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        // Drained, not read: closing mid-upload would cut the answer off.
        req.resume()
        return plain(res, 413, 'Payload Too Large')
      }
      const visitorIp = clientIp(req)
      if (!visitorIp) {
        req.resume()
        if (!reportedMissingAddress) {
          reportedMissingAddress = true
          console.error('proxy: the client IP callback returned no valid address; nothing was forwarded')
        }
        return plain(res, 500, 'The client IP callback returned no valid address')
      }
      const body = await readBody(req)
      if (body === null) return plain(res, 413, 'Payload Too Large')

      // Built from scratch: cookies, authorization and anything else the
      // visitor sent (including forged x-fingerly-* headers) never reach the API.
      const headers = new Headers({
        'content-type': header(req, 'content-type') ?? 'application/json',
        'x-api-key': publicKey,
        'x-fingerly-proxy-key': proxyKey,
        'x-fingerly-client-ip': visitorIp,
        'x-fingerly-user-agent': header(req, 'user-agent') ?? '',
        'x-fingerly-proxy-version': `${PRESET.kind}/${VERSION}`,
      })
      // One channel only: a browser Origin wins over a platform claim, as on
      // the API, which refuses a proxied request carrying both.
      if (origin) headers.set('x-fingerly-origin', origin)
      else if (sdkPlatform) headers.set('x-fingerly-sdk-platform', sdkPlatform)
      const host = header(req, 'host')
      if (host) headers.set('x-fingerly-host', host)
      for (const name of FORWARDED_CLIENT_HEADERS) {
        const value = header(req, name)
        if (value) headers.set(name, value)
      }
      for (const name of SIGNATURE_HEADERS) {
        const value = header(req, name)
        // Node reads header values as latin1: one character per byte.
        if (value && value.length <= MAX_SIGNATURE_HEADER_BYTES) headers.set(name, value)
      }

      // One deadline for the whole exchange, ended early if the visitor goes away.
      const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
      const gone = new AbortController()
      res.on('close', () => { if (!res.writableEnded) gone.abort() })
      const signal = AbortSignal.any([timeout, gone.signal])
      let upstream
      let answer
      try {
        upstream = await fetch(UPSTREAM, { method: 'POST', headers, body, redirect: 'manual', signal })
        // A redirect is never followed or relayed, and neither is a status
        // outside 200 to 599: the key went to the pinned URL only.
        if (!relayable(upstream.status) || upstream.redirected) {
          upstream.body?.cancel().catch(() => {})
          console.warn('proxy: upstream answered with an unusable status')
          return plain(res, 502, 'Bad gateway')
        }
        // Read whole, under the same deadline, before anything is sent back: a
        // truncated answer relayed with a 200 would be read as a success.
        answer = await readCapped(upstream.body, MAX_RESPONSE_BYTES)
      } catch {
        if (gone.signal.aborted) return
        const timedOut = timeout.aborted
        console.warn(timedOut ? 'proxy: upstream timed out' : 'proxy: upstream unreachable')
        return timedOut ? plain(res, 504, 'Gateway timeout') : plain(res, 502, 'Bad gateway')
      }
      if (answer === null) {
        console.warn('proxy: upstream answer over the size limit')
        return plain(res, 502, 'Bad gateway')
      }

      const outgoing = { 'cache-control': 'no-store' }
      for (const name of RELAYED_HEADERS) {
        const value = upstream.headers.get(name)
        if (value !== null) outgoing[name] = value
      }
      res.writeHead(upstream.status, outgoing)
      res.end(upstream.status === 204 || upstream.status === 205 ? undefined : answer)
    } catch {
      if (!res.headersSent) plain(res, 502, 'Bad gateway')
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
