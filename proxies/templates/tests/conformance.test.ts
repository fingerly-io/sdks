/**
 * One conformance suite for every code template: the Vercel middleware, the
 * Netlify edge function, the container and Cloud Run services (real node:http
 * servers on ephemeral ports) and the CloudFront function (loaded into a node:vm context
 * the way the cloudfront-js-2.0 runtime loads it, as a script with a global
 * `handler`). Upstream fetches are stubbed; nothing leaves the machine.
 */
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { request as httpRequest, type Server } from 'node:http'
import vm from 'node:vm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import vercel from '../vercel/middleware'
import netlify from '../netlify/edge-functions/relay'
import { createRelay } from '../gcp-cloud-run/server.mjs'
import { clientIpReader, createRelay as createContainerRelay } from '../container/server.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const KEY = 'fly_px_production_conformance'
const UPSTREAM = 'https://api.fingerly.io/api/v1/ingest'
const TRUSTED_IP = '203.0.113.9'
const realFetch = globalThis.fetch

interface Call {
  method?: string
  path?: string
  headers?: Record<string, string>
  body?: string
  /** The visitor's address, as the platform's trusted source presents it. */
  ip?: string
}
interface Outcome { status: number; headers: Headers; body: string }
interface Upstream { url: string; method: string; headers: Headers; body: string | null; redirect?: RequestInit['redirect'] }

/** What the stubbed API answers, including headers a proxy must not relay. */
function apiResponse(): Response {
  return new Response('{"request_id":"req_1"}', {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'req_1',
      'ratelimit-limit': '100',
      'ratelimit-remaining': '99',
      'fingerly-balance-micros': '1250',
      'set-cookie': 'session=abc; Path=/',
      'cache-control': 'max-age=60',
      server: 'fingerly-api',
    },
  })
}

/** The upstream requests the template made during the current test. */
let upstreamCalls: Upstream[] = []
let upstreamFails = false
/** How the stub API misbehaves, beyond being unreachable. */
let upstreamTrouble: 'none' | 'hang' | 'truncated' | 'huge' = 'none'

function stubUpstream(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body
    upstreamCalls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: body == null ? null : Buffer.from(body as ArrayBuffer).toString(),
      redirect: init?.redirect,
    })
    if (upstreamFails) throw new TypeError('fetch failed')
    if (upstreamTrouble === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
      })
    }
    if (upstreamTrouble === 'truncated') {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"request_id":'))
          controller.error(new TypeError('terminated'))
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (upstreamTrouble === 'huge') return new Response(new Uint8Array(4 * 1_048_576 + 1), { status: 200 })
    return apiResponse()
  }))
}

interface Target {
  kind: string
  /** Features the platform takes over, so the template has none of its own. */
  bodyCap: boolean
  missingKey: boolean
  /**
   * Whether the template sees the request target as sent. A web-standard
   * Request has already resolved dot segments (`/x/../`, `%2e%2e`) by the time
   * Vercel or Netlify code reads request.url.
   */
  rawTarget: boolean
  setKey(key: string | undefined): void
  call(call: Call): Promise<Outcome>
}

function webRequest(call: Call, extra: Record<string, string> = {}): Request {
  const method = call.method ?? 'POST'
  return new Request(`https://shop.example${call.path ?? '/k7x2qm4a'}`, {
    method,
    headers: { ...extra, ...call.headers },
    body: method === 'GET' || method === 'HEAD' ? null : call.body ?? '{}',
  })
}

async function outcome(response: Response): Promise<Outcome> {
  return { status: response.status, headers: response.headers, body: await response.text() }
}

const vercelTarget: Target = {
  kind: 'vercel',
  bodyCap: true,
  missingKey: true,
  rawTarget: false,
  setKey(key) {
    if (key === undefined) delete process.env.FINGERLY_PROXY_KEY
    else process.env.FINGERLY_PROXY_KEY = key
  },
  // Vercel sets x-real-ip and overwrites x-forwarded-for with the client address.
  call: async (call) => outcome(await vercel(webRequest(call, call.ip ? { 'x-real-ip': call.ip, 'x-forwarded-for': call.ip } : {}))),
}

let netlifyKey: string | undefined
const netlifyTarget: Target = {
  kind: 'netlify',
  bodyCap: true,
  missingKey: true,
  rawTarget: false,
  setKey(key) { netlifyKey = key },
  call: async (call) => outcome(await netlify(webRequest(call), { ip: call.ip ?? '' })),
}

/** A Node service template, listening for real on an ephemeral port. */
class NodeService implements Target {
  bodyCap = true
  missingKey = true
  rawTarget = true
  server: Server | undefined
  base = ''
  readonly env: Record<string, string | undefined>

  constructor(
    readonly kind: string,
    private readonly create: (env: Record<string, string | undefined>) => Server,
    env: Record<string, string | undefined>,
    /** How the service's front proxy presents the visitor's address. */
    private readonly front: (headers: Record<string, string>, ip: string) => void,
  ) {
    this.env = { FINGERLY_PATH: '/k7x2qm4a', ...env }
  }

  async listen(): Promise<void> {
    this.server = this.create(this.env)
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()))
  }

  setKey(key: string | undefined): void { this.env.FINGERLY_PROXY_KEY = key }

  /** Sent through node:http, so the request target goes out exactly as given. */
  async call(call: Call): Promise<Outcome> {
    const method = call.method ?? 'POST'
    const headers: Record<string, string> = { ...call.headers }
    if (call.ip) this.front(headers, call.ip)
    const body = method === 'GET' || method === 'HEAD' ? undefined : Buffer.from(call.body ?? '{}')
    if (body) headers['content-length'] = String(body.byteLength)
    const { port } = new URL(this.base)
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method, path: call.path ?? '/k7x2qm4a', headers }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const out = new Headers()
          for (const [name, value] of Object.entries(res.headers)) {
            for (const one of [value ?? []].flat()) out.append(name, one)
          }
          resolve({ status: res.statusCode ?? 0, headers: out, body: Buffer.concat(chunks).toString() })
        })
        res.on('error', reject)
      })
      req.on('error', reject)
      req.end(body)
    })
  }
}

// The load balancer appends `<client-ip>,<load-balancer-ip>`; anything the
// visitor sent sits to their left. The service's own preset reads xff:2.
const cloudRunTarget = new NodeService('gcp-cloud-run', createRelay, {}, (headers, ip) => {
  headers['x-forwarded-for'] = [headers['x-forwarded-for'], ip, '34.120.0.1'].filter(Boolean).join(',')
})
// Behind an edge that overwrites X-Real-Ip, as Traefik does.
const containerTarget = new NodeService('container', createContainerRelay, { FINGERLY_CLIENT_IP_SOURCE: 'header:x-real-ip' }, (headers, ip) => {
  headers['x-real-ip'] = ip
})

/**
 * The CloudFront function, run the way CloudFront runs it: the viewer request
 * event first; a returned response goes straight to the viewer, a returned
 * request goes to the origin with the origin's custom header applied, and the
 * origin's answer passes through the viewer response event.
 */
type CfValue = { value: string; attributes?: string }
type CfMap = Record<string, CfValue>
const cloudFrontContext = vm.createContext({})
vm.runInContext(readFileSync(`${ROOT}aws-cloudfront/function.js`, 'utf8'), cloudFrontContext, { filename: 'function.js' })
const cloudFrontHandler = cloudFrontContext.handler as (event: unknown) => Promise<Record<string, unknown>>
let cloudFrontOriginKey: string | undefined = KEY

function toCfHeaders(headers: Headers): CfMap {
  const map: CfMap = {}
  headers.forEach((value, name) => {
    if (name !== 'cookie' && name !== 'set-cookie') map[name] = { value }
  })
  return map
}

function toCfCookies(header: string | null): CfMap {
  const map: CfMap = {}
  for (const pair of (header ?? '').split(';')) {
    const [name, ...rest] = pair.trim().split('=')
    if (name) map[name] = { value: rest.join('=') }
  }
  return map
}

function fromCf(status: number, headers: CfMap, cookies: CfMap | undefined, body: string): Outcome {
  const out = new Headers()
  for (const [name, { value }] of Object.entries(headers)) out.set(name, value)
  for (const [name, cookie] of Object.entries(cookies ?? {})) out.append('set-cookie', `${name}=${cookie.value}`)
  return { status, headers: out, body }
}

const cloudFrontTarget: Target = {
  kind: 'aws-cloudfront',
  bodyCap: false,
  missingKey: false,
  rawTarget: true,
  setKey(key) { cloudFrontOriginKey = key },
  async call(call) {
    const request = webRequest(call)
    const viewerRequest = {
      version: '1.0',
      context: { eventType: 'viewer-request' },
      viewer: { ip: call.ip ?? '198.51.100.1' },
      request: {
        method: request.method,
        // The path as the viewer sent it. CloudFront normalizes a copy to
        // pick the cache behavior, then passes the raw path on.
        // The query string arrives apart, in querystring.
        uri: (call.path ?? '/k7x2qm4a').split('?')[0],
        querystring: Object.fromEntries([...new URLSearchParams((call.path ?? '').split('?')[1] ?? '')].map(([name, value]) => [name, { value }])),
        headers: { host: { value: 'shop.example' }, ...toCfHeaders(request.headers) },
        cookies: toCfCookies(request.headers.get('cookie')),
      },
    }
    const result = await cloudFrontHandler(JSON.parse(JSON.stringify(viewerRequest)))
    if (typeof result.statusCode === 'number') {
      return fromCf(result.statusCode, result.headers as CfMap, result.cookies as CfMap | undefined, '')
    }

    // CloudFront forwards the returned request to the origin, api.fingerly.io,
    // setting the origin custom header over any value of the same name.
    const forwarded = result as { method: string; uri: string; headers: CfMap; cookies: CfMap }
    const headers = new Headers()
    for (const [name, { value }] of Object.entries(forwarded.headers)) headers.set(name, value)
    const cookie = Object.entries(forwarded.cookies).map(([name, { value }]) => `${name}=${value}`).join('; ')
    if (cookie) headers.set('cookie', cookie)
    if (cloudFrontOriginKey) headers.set('x-fingerly-proxy-key', cloudFrontOriginKey)
    upstreamCalls.push({ url: `https://api.fingerly.io${forwarded.uri}`, method: forwarded.method, headers, body: null })

    const origin = apiResponse()
    const viewerResponse = {
      version: '1.0',
      context: { eventType: 'viewer-response' },
      viewer: viewerRequest.viewer,
      request: viewerRequest.request,
      response: {
        statusCode: origin.status,
        statusDescription: 'OK',
        headers: toCfHeaders(origin.headers),
        cookies: { session: { value: 'abc', attributes: 'Path=/' } },
      },
    }
    const relayed = await cloudFrontHandler(JSON.parse(JSON.stringify(viewerResponse))) as {
      statusCode: number; headers: CfMap; cookies: CfMap
    }
    return fromCf(relayed.statusCode, relayed.headers, relayed.cookies, await origin.text())
  },
}

const targets: Target[] = [vercelTarget, netlifyTarget, containerTarget, cloudRunTarget, cloudFrontTarget]

beforeAll(async () => {
  vi.stubGlobal('Netlify', { env: { get: (name: string) => (name === 'FINGERLY_PROXY_KEY' ? netlifyKey : undefined) } })
  await Promise.all([cloudRunTarget.listen(), containerTarget.listen()])
})

afterAll(async () => {
  vi.unstubAllGlobals()
  delete process.env.FINGERLY_PROXY_KEY
  await Promise.all([cloudRunTarget.close(), containerTarget.close()])
})

const visitor = {
  'content-type': 'application/json',
  'x-api-key': 'fly_pk_production_public',
  'idempotency-key': 'op-1',
  origin: 'https://shop.example',
  'user-agent': 'Mozilla/5.0 (conformance)',
  cookie: 'session=1; other=2',
  authorization: 'Bearer secret',
  'x-forwarded-for': '6.6.6.6',
  'x-fingerly-client-ip': '6.6.6.6',
  'x-fingerly-proxy-key': 'fly_px_production_forged',
  'x-fingerly-proxy-version': 'forged/9.9.9',
  'x-fingerly-origin': 'https://forged.example',
  'x-fingerly-other': 'forged',
}

describe.each(targets)('$kind template', (target) => {
  beforeAll(() => target.setKey(KEY))
  afterEach(() => {
    upstreamCalls = []
    upstreamFails = false
    target.setKey(KEY)
  })
  beforeAll(() => stubUpstream())

  it('answers exactly the issued path and nothing under or beside it', async () => {
    for (const path of ['/k7x2qm4a/', '/k7x2qm4a//', '/K7X2QM4A', '/k7x2qm4a%2F', '/k7x2qm4a/admin', '/k7x2qm4a/api/v1/identify', '/k7x2qm4ab', '/other', '/']) {
      const result = await target.call({ path, headers: visitor, ip: TRUSTED_IP })
      expect(result.status, path).toBe(404)
      expect(result.headers.get('cache-control')).toBe('no-store')
    }
    expect(upstreamCalls).toHaveLength(0)
    expect((await target.call({ path: '/k7x2qm4a', headers: visitor, ip: TRUSTED_IP })).status).toBe(200)
  })

  it('forwards nothing for a request target that only resolves to the issued path', async () => {
    const encoded = ['//k7x2qm4a', '/k7x2qm4a//', '/k7x2qm4a%2f', '/%6B7x2qm4a', '/k7x2qm4%61', '/k7x2qm4a%3F']
    const dotted = ['/x/../k7x2qm4a', '/./k7x2qm4a', '/k7x2qm4a/.', '/k7x2qm4a/x/..', '/%2e%2e/k7x2qm4a', '/x/%2E%2E/k7x2qm4a']
    for (const path of target.rawTarget ? [...encoded, ...dotted] : encoded) {
      const result = await target.call({ path, headers: visitor, ip: TRUSTED_IP })
      expect(result.status, path).toBe(404)
    }
    expect(upstreamCalls).toHaveLength(0)
    // The query string is not part of the path.
    expect((await target.call({ path: '/k7x2qm4a?v=1', headers: visitor, ip: TRUSTED_IP })).status).toBe(200)
  })

  it('answers 405 with Allow: POST for every other method', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const result = await target.call({ method, headers: { 'x-api-key': 'fly_pk_production_public' }, ip: TRUSTED_IP })
      expect(result.status, method).toBe(405)
      expect(result.headers.get('allow')).toBe('POST')
      expect(result.headers.get('cache-control')).toBe('no-store')
    }
    expect(upstreamCalls).toHaveLength(0)
  })

  it('forwards to the one ingest URL', async () => {
    const result = await target.call({ headers: visitor, body: '{"a":1}', ip: TRUSTED_IP })
    expect(result.status).toBe(200)
    expect(upstreamCalls).toHaveLength(1)
    const sent = upstreamCalls[0]!
    expect(sent.url).toBe(UPSTREAM)
    expect(sent.method).toBe('POST')
    // CloudFront Functions cannot see bodies; the body passes through untouched.
    if (target.kind !== 'aws-cloudfront') {
      expect(sent.body).toBe('{"a":1}')
      expect(sent.redirect).toBe('manual')
    }
    expect(sent.headers.get('content-type')).toBe('application/json')
    expect(sent.headers.get('x-api-key')).toBe('fly_pk_production_public')
    expect(sent.headers.get('idempotency-key')).toBe('op-1')
    expect(sent.headers.get('x-fingerly-origin')).toBe('https://shop.example')
    expect(sent.headers.get('x-fingerly-user-agent')).toBe('Mozilla/5.0 (conformance)')
  })

  it('overwrites every x-fingerly-* header the visitor sent', async () => {
    await target.call({ headers: visitor, ip: TRUSTED_IP })
    const sent = upstreamCalls[0]!.headers
    expect(sent.get('x-fingerly-proxy-key')).toBe(KEY)
    expect(sent.get('x-fingerly-client-ip')).toBe(TRUSTED_IP)
    expect(sent.get('x-fingerly-origin')).toBe('https://shop.example')
    expect(sent.get('x-fingerly-proxy-version')).toBe(`${target.kind}/1.0.0`)
    expect(sent.get('x-fingerly-other')).toBeNull()
    const forged = [...sent].filter(([, value]) => /forged|6\.6\.6\.6/.test(value))
    if (target.kind === 'aws-cloudfront') {
      // The origin request policy passes the visitor's x-forwarded-for through
      // untouched, as CloudFront does; the API reads x-fingerly-client-ip.
      expect(forged.map(([name]) => name)).toEqual(['x-forwarded-for'])
    } else {
      expect(forged).toEqual([])
    }
  })

  it('never forwards cookies or authorization', async () => {
    await target.call({ headers: visitor, ip: TRUSTED_IP })
    const sent = upstreamCalls[0]!.headers
    expect(sent.get('cookie')).toBeNull()
    expect(sent.get('authorization')).toBeNull()
  })

  it("takes the client IP from the platform's trusted source, not the forged header", async () => {
    await target.call({ headers: visitor, ip: '2001:db8::7' })
    expect(upstreamCalls[0]!.headers.get('x-fingerly-client-ip')).toBe('2001:db8::7')
  })

  it("uses the page's own origin when the client sends none", async () => {
    const { origin: _origin, ...withoutOrigin } = visitor
    await target.call({ headers: withoutOrigin, ip: TRUSTED_IP })
    const origin = upstreamCalls[0]!.headers.get('x-fingerly-origin')
    // The Node services see the Host of their loopback address.
    expect(origin).toBe(target instanceof NodeService ? `https://${new URL(target.base).host}` : 'https://shop.example')
  })

  it('relays only the allowlisted response headers, with no-store', async () => {
    const result = await target.call({ headers: visitor, ip: TRUSTED_IP })
    expect(result.headers.get('x-request-id')).toBe('req_1')
    expect(result.headers.get('ratelimit-limit')).toBe('100')
    expect(result.headers.get('ratelimit-remaining')).toBe('99')
    expect(result.headers.get('content-type')).toBe('application/json')
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(result.headers.get('fingerly-balance-micros')).toBeNull()
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(result.headers.get('server')).toBeNull()
    const relayed = [...result.headers].map(([name, value]) => `${name}: ${value}`).join('\n')
    expect(relayed).not.toMatch(/fingerly/i)
    expect(result.body).toBe('{"request_id":"req_1"}')
  })

  it.skipIf(!target.bodyCap)('refuses a body over 1 MiB without forwarding it', async () => {
    const over = await target.call({ headers: visitor, body: 'x'.repeat(1_048_577), ip: TRUSTED_IP })
    expect(over.status).toBe(413)
    expect(upstreamCalls).toHaveLength(0)
    const at = await target.call({ headers: visitor, body: 'x'.repeat(1_048_576), ip: TRUSTED_IP })
    expect(at.status).toBe(200)
  })

  it.skipIf(!target.missingKey)('answers 503 rather than forwarding when the proxy key is missing or malformed', async () => {
    for (const key of [undefined, '', 'fly_sk_production_secret', 'fly_px_sandbox_x']) {
      target.setKey(key)
      const result = await target.call({ headers: visitor, ip: TRUSTED_IP })
      expect(result.status, String(key)).toBe(503)
    }
    expect(upstreamCalls).toHaveLength(0)
  })

  it.skipIf(target.kind === 'aws-cloudfront')('answers 401 without a public key and 502 when the API is unreachable', async () => {
    const { 'x-api-key': _key, ...withoutKey } = visitor
    expect((await target.call({ headers: withoutKey, ip: TRUSTED_IP })).status).toBe(401)
    expect(upstreamCalls).toHaveLength(0)
    upstreamFails = true
    const failed = await target.call({ headers: visitor, ip: TRUSTED_IP })
    expect(failed.status).toBe(502)
    expect(failed.headers.get('cache-control')).toBe('no-store')
  })
})

describe.each([vercelTarget, netlifyTarget, containerTarget, cloudRunTarget])('$kind template under upstream trouble', (target) => {
  beforeAll(() => {
    stubUpstream()
    target.setKey(KEY)
  })
  afterEach(() => {
    upstreamCalls = []
    upstreamTrouble = 'none'
    vi.restoreAllMocks()
  })

  it('answers 504 when the API does not answer within the deadline', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    upstreamTrouble = 'hang'
    const result = await target.call({ headers: visitor, ip: TRUSTED_IP })
    expect(result.status).toBe(504)
    expect(result.body).toBe('Gateway timeout')
    expect(result.headers.get('cache-control')).toBe('no-store')
  }, 10_000)

  it('answers 502, never a truncated 200, when the answer breaks off', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    upstreamTrouble = 'truncated'
    const result = await target.call({ headers: visitor, ip: TRUSTED_IP })
    expect(result.status).toBe(502)
    expect(result.body).toBe('Bad gateway')
  })

  it('answers 502 for an answer over 4 MiB', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    upstreamTrouble = 'huge'
    const result = await target.call({ headers: visitor, ip: TRUSTED_IP })
    expect(result.status).toBe(502)
  })
})

describe('a client IP source with no valid address', () => {
  beforeAll(() => stubUpstream())
  afterEach(() => { upstreamCalls = [] })

  it.each([vercelTarget, netlifyTarget])('$kind: forwards nothing and answers 500', async (target) => {
    target.setKey(KEY)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const ip of ['', 'null', '1.2.3.4, 5.6.7.8', 'not-an-address']) {
      const headers = target.kind === 'vercel' ? { ...visitor, 'x-real-ip': ip, 'x-forwarded-for': ip } : visitor
      const result = await target.call({ headers, ip })
      expect(result.status, ip).toBe(500)
      expect(result.body).toMatch(/no valid address/)
      expect(result.headers.get('cache-control')).toBe('no-store')
    }
    expect(upstreamCalls).toHaveLength(0)
    expect(errors.mock.calls.length).toBeLessThanOrEqual(1)
    errors.mockRestore()
  })
})

describe('platform specifics', () => {
  beforeAll(() => stubUpstream())
  afterEach(() => { upstreamCalls = [] })

  it('vercel: falls back to the first x-forwarded-for entry Vercel wrote', async () => {
    vercelTarget.setKey(KEY)
    await vercel(new Request('https://shop.example/k7x2qm4a', {
      method: 'POST', headers: { 'x-api-key': 'fly_pk_production_public', 'x-forwarded-for': TRUSTED_IP }, body: '{}',
    }))
    expect(upstreamCalls[0]!.headers.get('x-fingerly-client-ip')).toBe(TRUSTED_IP)
  })

  it('gcp-cloud-run: takes the second-to-last x-forwarded-for entry and nothing a visitor can forge', async () => {
    cloudRunTarget.setKey(KEY)
    const post = (xff: string) => realFetch(`${cloudRunTarget.base}/k7x2qm4a`, {
      method: 'POST', headers: { 'x-api-key': 'fly_pk_production_public', 'x-forwarded-for': xff }, body: '{}',
    })
    await post(`1.1.1.1, 6.6.6.6,${TRUSTED_IP},34.120.0.1`)
    await post(`${TRUSTED_IP},34.120.0.1`)
    const alone = await post('6.6.6.6')
    expect(upstreamCalls.map((call) => call.headers.get('x-fingerly-client-ip'))).toEqual([TRUSTED_IP, TRUSTED_IP])
    // Too few entries to hold the load balancer's: nothing is forwarded.
    expect(alone.status).toBe(500)
  })

  it('gcp-cloud-run: answers nothing when FINGERLY_PATH is unset', async () => {
    const env = { FINGERLY_PROXY_KEY: KEY }
    const server = createRelay(env)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const response = await realFetch(`${base}/k7x2qm4a`, { method: 'POST', headers: { 'x-api-key': 'k' }, body: '{}' })
    await new Promise<void>((resolve) => server.close(() => resolve()))
    expect(response.status).toBe(404)
  })

  it('container: reads the address from the configured source only', () => {
    const req = (headers: Record<string, string>, remoteAddress = '::ffff:192.0.2.10') =>
      ({ headers, socket: { remoteAddress } }) as unknown as Parameters<ReturnType<typeof clientIpReader>>[0]
    const forged = { 'x-real-ip': '6.6.6.6', 'x-forwarded-for': '6.6.6.6' }
    expect(clientIpReader('remote')(req(forged))).toBe('192.0.2.10')
    expect(clientIpReader('remote')(req({}, '2001:db8::7'))).toBe('2001:db8::7')
    expect(clientIpReader('header:X-Real-Ip')(req({ 'x-real-ip': TRUSTED_IP }))).toBe(TRUSTED_IP)
    // A repeated header (joined with commas) or a value that is no address is refused.
    expect(clientIpReader('header:x-real-ip')(req({ 'x-real-ip': `${TRUSTED_IP}, 6.6.6.6` }))).toBe('')
    expect(clientIpReader('header:x-real-ip')(req({ 'x-real-ip': 'unknown' }))).toBe('')
    expect(clientIpReader('header:x-real-ip')(req({}))).toBe('')
    const xff = { 'x-forwarded-for': `6.6.6.6, ${TRUSTED_IP}, 10.0.0.2` }
    expect(clientIpReader('xff:1')(req(xff))).toBe('10.0.0.2')
    expect(clientIpReader('xff:2')(req(xff))).toBe(TRUSTED_IP)
    expect(clientIpReader('xff:4')(req(xff))).toBe('')
    for (const source of ['', 'left', 'xff:0', 'xff:-1', 'xff:x', 'header:', 'header:x real ip', 'remote ']) {
      expect(() => clientIpReader(source), source).toThrow(/FINGERLY_CLIENT_IP_SOURCE/)
    }
  })

  it('container: refuses to start with an unreadable FINGERLY_CLIENT_IP_SOURCE', () => {
    expect(() => createContainerRelay({ FINGERLY_PATH: '/k7x2qm4a', FINGERLY_CLIENT_IP_SOURCE: 'xff:first' })).toThrow(/FINGERLY_CLIENT_IP_SOURCE/)
  })

  it('container: defaults to the connection address and ignores forwarded headers', async () => {
    const server = createContainerRelay({ FINGERLY_PATH: '/k7x2qm4a', FINGERLY_PROXY_KEY: KEY })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    await realFetch(`${base}/k7x2qm4a`, {
      method: 'POST', headers: { 'x-api-key': 'fly_pk_production_public', 'x-real-ip': '6.6.6.6', 'x-forwarded-for': '6.6.6.6' }, body: '{}',
    })
    await new Promise<void>((resolve) => server.close(() => resolve()))
    expect(upstreamCalls[0]!.headers.get('x-fingerly-client-ip')).toBe('127.0.0.1')
    expect(upstreamCalls[0]!.headers.get('x-fingerly-proxy-version')).toBe('container/1.0.0')
  })

  it('container and gcp-cloud-run ship the same server, differing only in PRESET', () => {
    const container = readFileSync(`${ROOT}container/server.mjs`, 'utf8').split('\n')
    const cloudRun = readFileSync(`${ROOT}gcp-cloud-run/server.mjs`, 'utf8').split('\n')
    expect(cloudRun).toHaveLength(container.length)
    const differing = container.flatMap((line, index) => (line === cloudRun[index] ? [] : [`${line}\n${cloudRun[index]}`]))
    expect(differing).toEqual([
      "const PRESET = { kind: 'container', clientIpSource: 'remote' }\nconst PRESET = { kind: 'gcp-cloud-run', clientIpSource: 'xff:2' }",
    ])
  })

  it('aws-cloudfront: the CloudFormation fragment embeds function.js unchanged', () => {
    const yaml = readFileSync(`${ROOT}aws-cloudfront/cloudformation.yaml`, 'utf8').split('\n')
    const start = yaml.findIndex((line) => line.trim() === 'FunctionCode: |') + 1
    const block: string[] = []
    for (const line of yaml.slice(start)) {
      if (line.trim() !== '' && !line.startsWith('        ')) break
      block.push(line.slice(8))
    }
    const embedded = `${block.join('\n').trimEnd()}\n`
    expect(embedded).toBe(readFileSync(`${ROOT}aws-cloudfront/function.js`, 'utf8'))
  })

  it('aws-cloudfront: function.js is a plain script with a global handler, as cloudfront-js-2.0 requires', () => {
    const code = readFileSync(`${ROOT}aws-cloudfront/function.js`, 'utf8')
    expect(code).not.toMatch(/^\s*(import|export)\s/m)
    expect(code).not.toMatch(/\brequire\(|module\.exports/)
    expect(code).toMatch(/^async function handler\(event\)/m)
    expect(Buffer.byteLength(code)).toBeLessThan(10_240)
  })
})
