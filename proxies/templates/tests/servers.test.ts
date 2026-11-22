/**
 * The nginx, Caddy, container and Traefik templates, run for real in Docker
 * against a stub API.
 *
 * Each deployment uses test copies of the shipped files with only the upstream
 * swapped for a stub listening in this process (reached from the containers as
 * host.docker.internal); the shipped files keep https://api.fingerly.io.
 * Traefik runs twice: from the file-provider YAML (behind a longer catch-all
 * router, to prove the priority) and from the docker-compose labels (built by
 * compose from the container template's Dockerfile). Without Docker the suite
 * is skipped, not failed.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = new URL('..', import.meta.url).pathname
const KEY = 'fly_px_production_integration'
const SHIPPED_UPSTREAM_NGINX = 'proxy_pass https://api.fingerly.io/api/v1/ingest;'
const SHIPPED_UPSTREAM_CADDY = 'reverse_proxy https://api.fingerly.io {'
const SHIPPED_UPSTREAM_NODE = "const UPSTREAM = 'https://api.fingerly.io/api/v1/ingest'"
const TRAEFIK_IMAGE = 'traefik:v3'

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 20_000 })
    return true
  } catch {
    return false
  }
}

const docker = dockerAvailable()
if (!docker) console.warn('Docker is not available: skipping the nginx, Caddy, container and Traefik integration tests.')

function run(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync('docker', args, { stdio: 'pipe', env }).toString()
}

function quietly(args: string[]): void {
  try {
    execFileSync('docker', args, { stdio: 'ignore' })
  } catch {
    // Already gone.
  }
}

const id = () => randomBytes(4).toString('hex')

interface Seen { method: string; url: string; headers: IncomingHttpHeaders; body: string }

/** The stub API: records every request and answers like the real one, plus cookies and internal headers. */
class StubApi {
  seen: Seen[] = []
  /** The status to answer with; anything but 200 also carries a Location to steal. */
  status = 200
  private server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      this.seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString() })
      res.writeHead(this.status, {
        ...(this.status === 200 ? {} : { location: 'https://elsewhere.example/steal' }),
        'content-type': 'application/json',
        'x-request-id': 'req_stub',
        'ratelimit-limit': '100',
        'ratelimit-remaining': '99',
        'retry-after': '1',
        'fingerly-balance-micros': '100',
        'fingerly-ratelimit-scope': 'org',
        'x-fingerly-proxy-version': 'api',
        'set-cookie': 'session=abc; Path=/',
        'cache-control': 'max-age=60',
        server: 'fingerly-api',
        // Headers outside the relay list, as a future API might add them.
        'x-new-internal': '1',
        'x-powered-by': 'api-stack',
        via: '1.1 api-internal',
      })
      res.end('{"request_id":"req_stub"}')
    })
  })

  async start(): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    return (this.server.address() as AddressInfo).port
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}

/** Something running in Docker with one front door on an ephemeral loopback port. */
interface Deployment {
  base: string
  start(): Promise<void>
  stop(): void
  logs(): string
}

/** Polls until the front door answers, and answers the way `ready` wants. */
async function waitFor(deployment: Deployment, ready: (response: Response) => boolean, path = '/ready'): Promise<void> {
  const deadline = Date.now() + 60_000
  let last = 'no answer'
  for (;;) {
    try {
      const response = await fetch(`${deployment.base}${path}`)
      if (ready(response)) return
      last = `${response.status} ${await response.text()}`
    } catch (error) {
      // Not listening yet.
      last = String((error as Error).cause ?? error)
    }
    if (Date.now() > deadline) throw new Error(`the deployment did not become ready (${deployment.base}${path}: ${last}):\n${deployment.logs()}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/**
 * The host address Docker published a port on. Right after `docker run -d`
 * the mapping can still be empty, so it is asked for again until it is there.
 */
async function published(port: () => string): Promise<string> {
  const deadline = Date.now() + 30_000
  for (;;) {
    let address = ''
    try {
      address = port().trim().split('\n')[0] ?? ''
    } catch {
      // Not published yet.
    }
    if (/^[\d.]+:\d+$/.test(address)) return address
    if (Date.now() > deadline) throw new Error(`docker published no address: ${JSON.stringify(address)}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/** Containers on a private network; the first one is published. */
class Stack implements Deployment {
  base = ''
  private readonly network = `fingerly-tpl-${id()}`
  private readonly names: string[] = []

  constructor(
    private readonly containers: Array<{ args: string[]; alias?: string }>,
    private readonly port: number,
    private readonly ready: { path?: string; when: (response: Response) => boolean } = { when: () => true },
  ) {}

  async start(): Promise<void> {
    run(['network', 'create', this.network])
    for (const [index, container] of this.containers.entries()) {
      const name = `fingerly-tpl-${id()}`
      this.names.push(name)
      run([
        'run', '-d', '--name', name, '--network', this.network, '--add-host=host.docker.internal:host-gateway',
        ...(container.alias ? ['--network-alias', container.alias] : []),
        ...(index === 0 ? ['-p', `127.0.0.1::${this.port}`] : []),
        ...container.args,
      ])
    }
    this.base = `http://${await published(() => run(['port', this.names[0]!, `${this.port}/tcp`]))}`
    await waitFor(this, this.ready.when, this.ready.path)
  }

  /** The name of the n-th container, for docker exec. */
  name(index: number): string {
    return this.names[index]!
  }

  logs(): string {
    return this.names.map((name) => {
      try {
        return `--- ${name}\n${run(['logs', name])}`
      } catch {
        return ''
      }
    }).join('\n')
  }

  stop(): void {
    for (const name of this.names) quietly(['rm', '-f', name])
    quietly(['network', 'rm', this.network])
  }
}

/** A docker compose project; `front` is the published service. */
class Compose implements Deployment {
  base = ''
  private readonly project = `fingerly-tpl-${id()}`

  constructor(
    private readonly dir: string,
    private readonly files: string[],
    private readonly env: NodeJS.ProcessEnv,
    private readonly front: { service: string; port: number },
    private readonly ready: { path?: string; when: (response: Response) => boolean },
  ) {}

  private compose(args: string[]): string {
    return run(['compose', '--project-directory', this.dir, '-p', this.project, ...this.files.flatMap((file) => ['-f', join(this.dir, file)]), ...args], { ...process.env, ...this.env })
  }

  async start(): Promise<void> {
    this.compose(['up', '-d', '--build', '--quiet-pull'])
    this.base = `http://${await published(() => this.compose(['port', this.front.service, String(this.front.port)]))}`
    await waitFor(this, this.ready.when, this.ready.path)
  }

  logs(): string {
    try {
      return this.compose(['logs', '--no-color'])
    } catch {
      return ''
    }
  }

  stop(): void {
    try {
      this.compose(['down', '-v', '--rmi', 'local', '--remove-orphans'])
    } catch {
      // Already gone.
    }
  }
}

/** A build context holding the container template, calling the stub instead of the API. */
function relayContext(dir: string, stubPort: number): string {
  const shipped = readFileSync(join(ROOT, 'container/server.mjs'), 'utf8')
  if (!shipped.includes(SHIPPED_UPSTREAM_NODE)) throw new Error('the shipped container server no longer names the API upstream')
  const context = join(dir, `relay-${id()}`)
  mkdirSync(context)
  copyFileSync(join(ROOT, 'container/Dockerfile'), join(context, 'Dockerfile'))
  writeFileSync(join(context, 'server.mjs'), shipped.replace(SHIPPED_UPSTREAM_NODE, `const UPSTREAM = 'http://host.docker.internal:${stubPort}/api/v1/ingest'`))
  return context
}

const builtImages: string[] = []
function relayImage(dir: string, stubPort: number): string {
  const tag = `fingerly-tpl-relay:${id()}`
  run(['build', '-q', '-t', tag, relayContext(dir, stubPort)])
  builtImages.push(tag)
  return tag
}

/** `--env-file` for a file holding FINGERLY_PROXY_KEY, readable only by its owner, as the READMEs write it; nothing without a key. */
function keyEnvFile(dir: string, key: string): string[] {
  if (!key) return []
  const envFile = join(dir, `key-${id()}.env`)
  writeFileSync(envFile, `FINGERLY_PROXY_KEY=${key}\n`, { mode: 0o600 })
  return ['--env-file', envFile]
}

/**
 * The environment a template's own files tell the container to use, with the
 * key in an environment file readable only by its owner, as the README has it.
 */
function relayEnv(dir: string, key: string, source?: string): string[] {
  return [
    ...keyEnvFile(dir, key),
    '-e', 'FINGERLY_PATH=/k7x2qm4a',
    ...(source ? ['-e', `FINGERLY_CLIENT_IP_SOURCE=${source}`] : []),
  ]
}

/** FINGERLY_CLIENT_IP_SOURCE as the shipped docker-compose.yml sets it. */
function composeClientIpSource(): string {
  const match = /FINGERLY_CLIENT_IP_SOURCE: (\S+)/.exec(readFileSync(join(ROOT, 'traefik/docker-compose.yml'), 'utf8'))
  if (!match) throw new Error('traefik/docker-compose.yml no longer sets FINGERLY_CLIENT_IP_SOURCE')
  return match[1]!
}

/**
 * Traefik cleans the path before routing (dot segments, doubled slashes,
 * percent-encoded unreserved characters) and forwards the cleaned path, so
 * these reach the container as `/k7x2qm4a`. With sanitizePath off it still
 * decodes the characters.
 */
const TRAEFIK_RESOLVES = ['/x/../k7x2qm4a', '/./k7x2qm4a', '/k7x2qm4a/.', '/k7x2qm4a/x/..', '/%2e%2e/k7x2qm4a', '//k7x2qm4a', '/%6B7x2qm4a', '/k7x2qm4%61']

const relayReady = { path: '/k7x2qm4a', when: (response: Response) => response.status === 405 }

const NGINX_LOAD_MODULE = 'load_module modules/ngx_http_js_module.so;'

const NGINX_PLATFORM_MAP = [
  'map "$http_origin:$http_x_fingerly_sdk_platform" $fingerly_platform {',
  '    default "";',
  '    "~^:(ios|android|react-native|react-native-ios|react-native-android|flutter|flutter-ios|flutter-android|lynx-ios|lynx-android|capacitor|kotlin-multiplatform)$" $1;',
  '}',
  '',
].join('\n')

interface Template {
  kind: string
  /** What the deployment reports upstream as x-fingerly-proxy-version. */
  version: string
  /** Whether a second, keyless deployment is started to check the 503. */
  keyless: boolean
  deploy(stubPort: number, dir: string, key: string): Deployment
  upstreamHost(stubPort: number): string
  /** What answers a path beside the issued one. */
  elsewhere: { status: number; body?: string }
  /**
   * Near targets the front server resolves to the issued path itself, before
   * routing, and forwards cleaned: the relay behind it never sees them raw.
   */
  resolvedInFront?: string[]
}

const templates: Template[] = [
  {
    kind: 'nginx',
    version: 'nginx/1.1.0',
    keyless: true,
    deploy(stubPort, dir, key) {
      const shipped = readFileSync(join(ROOT, 'nginx/fingerly.conf'), 'utf8')
      if (!shipped.includes(SHIPPED_UPSTREAM_NGINX)) throw new Error('the shipped nginx template no longer names the API upstream')
      const n = id()
      writeFileSync(join(dir, `fingerly-${n}.conf`), shipped.replace(SHIPPED_UPSTREAM_NGINX, `proxy_pass http://host.docker.internal:${stubPort}/api/v1/ingest;`))
      writeFileSync(join(dir, `key-${n}.conf`), `set $fingerly_proxy_key "${key}";\n`)
      writeFileSync(join(dir, `site-${n}.conf`), `${NGINX_PLATFORM_MAP}server {\n    listen 8080;\n    include /etc/nginx/snippets/fingerly.conf;\n    location / { return 200 "site"; }\n}\n`)
      // The image's own main configuration, plus the load_module line the README adds.
      writeFileSync(join(dir, `nginx-${n}.conf`), [
        NGINX_LOAD_MODULE,
        'user nginx;',
        'worker_processes 1;',
        'events {}',
        'http {',
        '    include /etc/nginx/mime.types;',
        '    include /etc/nginx/conf.d/*.conf;',
        '}',
        '',
      ].join('\n'))
      return new Stack([{
        args: [
          '-v', `${join(dir, `nginx-${n}.conf`)}:/etc/nginx/nginx.conf:ro`,
          '-v', `${join(ROOT, 'nginx/fingerly.js')}:/etc/nginx/fingerly.js:ro`,
          '-v', `${join(dir, `site-${n}.conf`)}:/etc/nginx/conf.d/default.conf:ro`,
          '-v', `${join(dir, `fingerly-${n}.conf`)}:/etc/nginx/snippets/fingerly.conf:ro`,
          '-v', `${join(dir, `key-${n}.conf`)}:/etc/nginx/fingerly-proxy-key.conf:ro`,
          'nginx:alpine',
        ],
      }], 8080)
    },
    upstreamHost: () => 'api.fingerly.io',
    elsewhere: { status: 200, body: 'site' },
  },
  {
    kind: 'caddy',
    version: 'caddy/1.1.0',
    keyless: true,
    deploy(stubPort, dir, key) {
      const shipped = readFileSync(join(ROOT, 'caddy/Caddyfile'), 'utf8')
      if (!shipped.includes(SHIPPED_UPSTREAM_CADDY)) throw new Error('the shipped Caddyfile no longer names the API upstream')
      const file = join(dir, `Caddyfile-${id()}`)
      writeFileSync(file, shipped
        .replace(SHIPPED_UPSTREAM_CADDY, `reverse_proxy http://host.docker.internal:${stubPort} {`)
        .replace('www.example.com {', ':8080 {')
        .replace('# ... the rest of your site ...', 'respond "site" 200'))
      return new Stack([{
        // The key file the README writes, as the process environment.
        args: [...keyEnvFile(dir, key), '-v', `${file}:/etc/caddy/Caddyfile:ro`, 'caddy:alpine'],
      }], 8080)
    },
    upstreamHost: (stubPort) => `host.docker.internal:${stubPort}`,
    elsewhere: { status: 200, body: 'site' },
  },
  {
    kind: 'container',
    version: 'container/1.1.0',
    keyless: true,
    // Reached directly, so the default source, the connection itself.
    deploy: (stubPort, dir, key) => new Stack([{ args: [...relayEnv(dir, key), relayImage(dir, stubPort)] }], 8080, relayReady),
    upstreamHost: (stubPort) => `host.docker.internal:${stubPort}`,
    elsewhere: { status: 404 },
  },
  {
    kind: 'traefik (file provider)',
    version: 'container/1.1.0',
    keyless: false,
    deploy(stubPort, dir, key) {
      const dynamic = join(dir, `dynamic-${id()}`)
      mkdirSync(dynamic)
      copyFileSync(join(ROOT, 'traefik/dynamic.yml'), join(dynamic, 'dynamic.yml'))
      // A site router with a longer rule than the relay's, answering 502 from
      // a closed port: the relay only wins through its priority.
      writeFileSync(join(dynamic, 'site.yml'), [
        'http:',
        '  routers:',
        '    site:',
        '      rule: "HostRegexp(`.+`) || PathPrefix(`/`)"',
        '      service: site',
        '  services:',
        '    site:',
        '      loadBalancer:',
        '        servers:',
        '          - url: "http://127.0.0.1:9"',
        '',
      ].join('\n'))
      return new Stack([
        {
          args: [
            '-v', `${dynamic}:/etc/traefik/dynamic:ro`, TRAEFIK_IMAGE,
            '--entrypoints.web.address=:8080', '--providers.file.directory=/etc/traefik/dynamic',
          ],
        },
        { alias: 'site-relay', args: [...relayEnv(dir, key, composeClientIpSource()), relayImage(dir, stubPort)] },
      ], 8080, relayReady)
    },
    upstreamHost: (stubPort) => `host.docker.internal:${stubPort}`,
    elsewhere: { status: 502 },
    resolvedInFront: TRAEFIK_RESOLVES,
  },
  {
    kind: 'traefik (docker-compose labels)',
    version: 'container/1.1.0',
    keyless: false,
    deploy(stubPort, dir, key) {
      const project = join(dir, `compose-${id()}`)
      mkdirSync(project)
      copyFileSync(join(ROOT, 'traefik/docker-compose.yml'), join(project, 'docker-compose.yml'))
      // The key file the README writes beside the compose file.
      writeFileSync(join(project, 'site-relay.env'), `FINGERLY_PROXY_KEY=${key}\n`, { mode: 0o600 })
      // The documented layout: the container template in ./site-relay.
      const context = relayContext(dir, stubPort)
      mkdirSync(join(project, 'site-relay'))
      for (const file of ['Dockerfile', 'server.mjs']) copyFileSync(join(context, file), join(project, 'site-relay', file))
      writeFileSync(join(project, 'traefik.yml'), [
        'services:',
        '  traefik:',
        `    image: ${TRAEFIK_IMAGE}`,
        '    command: ["--providers.docker=true", "--providers.docker.exposedbydefault=false", "--entrypoints.web.address=:8080"]',
        '    ports: ["127.0.0.1::8080"]',
        '    volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"]',
        '  site-relay:',
        '    extra_hosts: ["host.docker.internal:host-gateway"]',
        '',
      ].join('\n'))
      return new Compose(project, ['docker-compose.yml', 'traefik.yml'], {}, { service: 'traefik', port: 8080 }, relayReady)
    },
    upstreamHost: (stubPort) => `host.docker.internal:${stubPort}`,
    elsewhere: { status: 404 },
    resolvedInFront: TRAEFIK_RESOLVES,
  },
]

const visitorHeaders = {
  'content-type': 'application/json',
  'x-api-key': 'fly_pk_production_public',
  'idempotency-key': 'op-1',
  origin: 'https://shop.example',
  'user-agent': 'Mozilla/5.0 (integration)',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
  'sec-ch-ua': '"Chromium";v="130"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  signature: 'sig1=:dGVzdC1zaWduYXR1cmU=:',
  'signature-input': 'sig1=("@authority" "signature-agent");created=1735689600;keyid="k1";alg="ed25519";tag="web-bot-auth"',
  'signature-agent': '"https://chatgpt.com"',
  cookie: 'session=1',
  authorization: 'Bearer secret',
  'x-forwarded-for': '6.6.6.6',
  'x-real-ip': '6.6.6.6',
  'x-fingerly-client-ip': '6.6.6.6',
  'x-fingerly-proxy-key': 'fly_px_production_forged',
  'x-fingerly-proxy-version': 'forged/9.9.9',
  'x-fingerly-origin': 'https://forged.example',
  'x-fingerly-edge-tls-version': 'forged-tls',
  'x-fingerly-sdk-platform': 'EvilOS',
  'x-fingerly-other': 'forged',
}

/** Headers outside the contract a page, a wrapper or a forger can add to a same-origin POST. */
const UNLISTED_REQUEST = {
  referer: 'https://shop.example/reset?token=secret-token',
  'x-custom-token': 'app-header',
  forwarded: 'for=203.0.113.9',
  'x-forwarded-host': 'forged.example',
  'accept-language': 'tr-TR,tr;q=0.9',
  'x-requested-with': 'wrapper',
}
/** Names the contract (sdks/contract/proxy.md section 3) lets a proxy send upstream. */
const CONTRACT_REQUEST = /^(x-api-key|content-type|idempotency-key|user-agent|sec-fetch-(site|mode|dest)|sec-ch-ua(-mobile|-platform)?|signature(-input|-agent)?|x-fingerly-[a-z-]+)$/
/** Framing headers, which are not a forwarding decision. */
const TRANSPORT_REQUEST = /^(host|content-length|connection|accept-encoding|transfer-encoding)$/
/** The response headers the contract relays (section 4), plus the pinned Cache-Control. */
const RELAYED_RESPONSE = /^(x-request-id|ratelimit-limit|ratelimit-remaining|retry-after|content-type|cache-control)$/
/** Framing headers and the front server's own name. */
const TRANSPORT_RESPONSE = /^(content-length|connection|transfer-encoding|date|keep-alive|server)$/

/**
 * Request targets that are not the issued path but that URL parsing, path
 * cleaning or percent-decoding would turn into it. fetch() normalises these
 * before sending, so they go out verbatim through node:http.
 */
const NEAR_TARGETS = [
  '/x/../k7x2qm4a',
  '/./k7x2qm4a',
  '/k7x2qm4a/.',
  '/k7x2qm4a/x/..',
  '/%2e%2e/k7x2qm4a',
  '//k7x2qm4a',
  '/k7x2qm4a//',
  '/k7x2qm4a%2F',
  '/k7x2qm4a%2f',
  '/%6B7x2qm4a',
  '/k7x2qm4%61',
  '/K7X2QM4A',
]

/** A POST with the request target sent exactly as given. */
function rawPost(base: string, target: string): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(base)
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: hostname, port, agent: false, method: 'POST', path: target, headers: { ...visitorHeaders, 'content-length': '2' } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end('{}')
  })
}

afterAll(() => {
  for (const tag of builtImages) quietly(['rmi', '-f', tag])
})

describe.skipIf(!docker).each(templates)('$kind template', (template) => {
  const stub = new StubApi()
  let stubPort = 0
  let dir = ''
  let proxy: Deployment | undefined
  let keyless: Deployment | undefined

  beforeAll(async () => {
    stubPort = await stub.start()
    dir = mkdtempSync(join(tmpdir(), 'fingerly-tpl-'))
    proxy = template.deploy(stubPort, dir, KEY)
    keyless = template.keyless ? template.deploy(stubPort, dir, '') : undefined
    await Promise.all([proxy.start(), keyless?.start()])
  })

  afterAll(async () => {
    proxy?.stop()
    keyless?.stop()
    await stub.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('forwards to the ingest URL with visitor metadata, client hints, and raw body bytes, stripping forged headers', async () => {
    stub.seen = []
    const rawBody = '{ "v": 3, "signals": { "amount": 142.50 } }'
    const response = await fetch(`${proxy!.base}/k7x2qm4a`, { method: 'POST', headers: visitorHeaders, body: rawBody })
    expect(response.status, proxy!.logs()).toBe(200)
    expect(stub.seen).toHaveLength(1)
    const seen = stub.seen[0]!
    expect(seen.method).toBe('POST')
    expect(seen.url).toBe('/api/v1/ingest')
    expect(seen.body).toBe(rawBody)
    expect(seen.headers.host).toBe(template.upstreamHost(stubPort))
    expect(seen.headers['content-type']).toBe('application/json')
    expect(seen.headers['x-api-key']).toBe('fly_pk_production_public')
    expect(seen.headers['idempotency-key']).toBe('op-1')
    expect(seen.headers['sec-fetch-site']).toBe('same-origin')
    expect(seen.headers['sec-fetch-mode']).toBe('cors')
    expect(seen.headers['sec-fetch-dest']).toBe('empty')
    expect(seen.headers['sec-ch-ua']).toBe('"Chromium";v="130"')
    expect(seen.headers['sec-ch-ua-mobile']).toBe('?0')
    expect(seen.headers['sec-ch-ua-platform']).toBe('"macOS"')
    expect(seen.headers.signature).toBe(visitorHeaders.signature)
    expect(seen.headers['signature-input']).toBe(visitorHeaders['signature-input'])
    expect(seen.headers['signature-agent']).toBe(visitorHeaders['signature-agent'])
    expect(seen.headers['x-fingerly-host']).toBe(new URL(proxy!.base).host)
    expect(seen.headers['x-fingerly-proxy-key']).toBe(KEY)
    expect(seen.headers['x-fingerly-proxy-version']).toBe(template.version)
    expect(seen.headers['x-fingerly-origin']).toBe('https://shop.example')
    expect(seen.headers['x-fingerly-user-agent']).toBe('Mozilla/5.0 (integration)')
    // The address of the connection the front server accepted: never a forged header.
    expect(seen.headers['x-fingerly-client-ip']).toMatch(/^[0-9a-f.:]+$/)
    expect(seen.headers['x-fingerly-client-ip']).not.toBe('6.6.6.6')
    expect(seen.headers['x-fingerly-sdk-platform']).toBeUndefined()
    expect(seen.headers['x-fingerly-edge-tls-version']).toBeUndefined()
    expect(seen.headers['x-fingerly-other']).toBeUndefined()
    expect(seen.headers.cookie).toBeUndefined()
    expect(seen.headers.authorization).toBeUndefined()
  })

  it('drops a Web Bot Auth header over 4096 bytes in code, while nginx and Caddy send it as is', async () => {
    stub.seen = []
    const oversized = `sig1=:${'A'.repeat(4097)}:`
    const response = await fetch(`${proxy!.base}/k7x2qm4a`, { method: 'POST', headers: { ...visitorHeaders, signature: oversized }, body: '{}' })
    expect(response.status, proxy!.logs()).toBe(200)
    const seen = stub.seen[0]!
    const asSent = template.kind === 'nginx' || template.kind === 'caddy'
    expect(seen.headers.signature).toBe(asSent ? oversized : undefined)
    expect(seen.headers['signature-input']).toBe(visitorHeaders['signature-input'])
    expect(seen.headers['signature-agent']).toBe(visitorHeaders['signature-agent'])
  })

  it('relays the request id, rate limits and retry-after, drops cookies and internal headers, and pins no-store', async () => {
    const response = await fetch(`${proxy!.base}/k7x2qm4a`, { method: 'POST', headers: visitorHeaders, body: '{}' })
    expect(response.headers.get('x-request-id')).toBe('req_stub')
    expect(response.headers.get('ratelimit-remaining')).toBe('99')
    expect(response.headers.get('retry-after')).toBe('1')
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('fingerly-balance-micros')).toBeNull()
    expect(response.headers.get('fingerly-ratelimit-scope')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('{"request_id":"req_stub"}')
  })

  it('forwards only the contract request headers, whatever else the visitor sends', async () => {
    stub.seen = []
    const response = await fetch(`${proxy!.base}/k7x2qm4a`, { method: 'POST', headers: { ...visitorHeaders, ...UNLISTED_REQUEST }, body: '{}' })
    expect(response.status, proxy!.logs()).toBe(200)
    const seen = stub.seen[0]!
    const outside = Object.keys(seen.headers).filter((name) => !CONTRACT_REQUEST.test(name) && !TRANSPORT_REQUEST.test(name))
    // The Node relays' own HTTP client adds `accept` and `accept-language: *`;
    // neither carries a visitor value.
    const runtime = template.kind === 'nginx' || template.kind === 'caddy' ? [] : ['accept', 'accept-language']
    expect(outside.filter((name) => !runtime.includes(name)), JSON.stringify(seen.headers)).toEqual([])
    expect(seen.headers['accept-language']).not.toBe(UNLISTED_REQUEST['accept-language'])
    expect(seen.headers['x-custom-token']).toBeUndefined()
    expect(seen.headers.signature).toBe(visitorHeaders.signature)
    expect(seen.headers.origin).toBeUndefined()
    expect(seen.headers['x-fingerly-origin']).toBe('https://shop.example')
    expect(seen.headers['x-fingerly-client-ip']).not.toBe('6.6.6.6')
  })

  it('relays only the allowlisted response headers, whatever the API adds', async () => {
    const response = await fetch(`${proxy!.base}/k7x2qm4a`, { method: 'POST', headers: visitorHeaders, body: '{}' })
    expect(response.status, proxy!.logs()).toBe(200)
    const outside = [...response.headers.keys()].filter((name) => !RELAYED_RESPONSE.test(name) && !TRANSPORT_RESPONSE.test(name))
    expect(outside, JSON.stringify([...response.headers])).toEqual([])
    // A front server may name itself, but never relays the API's value or a version.
    expect(response.headers.get('server') ?? '').not.toMatch(/fingerly|api|\d/)
  })

  it('answers 401 locally for an X-Api-Key that is not a public key of the proxy key environment', async () => {
    for (const key of ['fly_pk_development_x', 'fly_pk_staging_x', 'not-a-key', 'fly_sk_production_x', 'fly_pk_production_', 'fly_pk_production_a b', undefined]) {
      stub.seen = []
      const headers: Record<string, string> = { ...visitorHeaders }
      if (key === undefined) delete headers['x-api-key']
      else headers['x-api-key'] = key
      const response = await fetch(`${proxy!.base}/k7x2qm4a`, { method: 'POST', headers, body: '{}' })
      expect(response.status, String(key)).toBe(401)
      expect(response.headers.get('cache-control'), String(key)).toBe('no-store')
      expect(stub.seen, String(key)).toHaveLength(0)
    }
  })

  it('rejects originless POST without valid x-fingerly-sdk-platform with 400 missing_origin and never synthesizes x-fingerly-origin', async () => {
    stub.seen = []
    const { origin: _origin, 'x-fingerly-sdk-platform': _platform, ...withoutOrigin } = visitorHeaders
    const response = await fetch(`${proxy!.base}/k7x2qm4a`, {
      method: 'POST',
      headers: { ...withoutOrigin, referer: 'https://shop.example/checkout' },
      body: '{}',
    })
    expect(response.status, proxy!.logs()).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      error: { code: 'missing_origin', message: 'Origin or X-Fingerly-SDK-Platform header is required' },
    })

    for (const invalid of ['EvilOS', 'iOS', 'IOS', 'ios, android']) {
      const rejected = await fetch(`${proxy!.base}/k7x2qm4a`, {
        method: 'POST',
        headers: { ...withoutOrigin, 'x-fingerly-sdk-platform': invalid },
        body: '{}',
      })
      expect(rejected.status, invalid).toBe(400)
      expect(rejected.headers.get('cache-control')).toBe('no-store')
      expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe('missing_origin')
    }
    expect(stub.seen).toHaveLength(0)
  })

  it('forwards valid native POST without Origin, restoring x-fingerly-sdk-platform and omitting x-fingerly-origin', async () => {
    const { origin: _origin, ...withoutOrigin } = visitorHeaders
    for (const platform of ['ios', 'android', 'react-native-ios']) {
      stub.seen = []
      const response = await fetch(`${proxy!.base}/k7x2qm4a`, {
        method: 'POST',
        headers: { ...withoutOrigin, 'x-fingerly-sdk-platform': platform },
        body: '{}',
      })
      expect(response.status, `${platform}: ${proxy!.logs()}`).toBe(200)
      expect(stub.seen).toHaveLength(1)
      const seen = stub.seen[0]!
      expect(seen.headers['x-fingerly-sdk-platform']).toBe(platform)
      expect(seen.headers['x-fingerly-origin']).toBeUndefined()
      expect(seen.headers['x-fingerly-edge-tls-version']).toBeUndefined()
    }
  })

  it('sends one channel header: a valid platform beside Origin is dropped and only x-fingerly-origin goes upstream', async () => {
    for (const platform of ['ios', 'android', 'react-native-ios']) {
      stub.seen = []
      const response = await fetch(`${proxy!.base}/k7x2qm4a`, {
        method: 'POST',
        headers: { ...visitorHeaders, 'x-fingerly-sdk-platform': platform },
        body: '{}',
      })
      expect(response.status, `${platform}: ${proxy!.logs()}`).toBe(200)
      expect(stub.seen).toHaveLength(1)
      const seen = stub.seen[0]!
      expect(seen.headers['x-fingerly-origin']).toBe('https://shop.example')
      expect(seen.headers['x-fingerly-sdk-platform']).toBeUndefined()
    }
  })

  it('answers exactly the issued path and never forwards /supplement', async () => {
    stub.seen = []
    for (const path of ['/k7x2qm4a/supplement', '/k7x2qm4a/events/evt_1/supplement', '/k7x2qm4a/admin', '/k7x2qm4ab', '/other']) {
      const response = await fetch(`${proxy!.base}${path}`, { method: 'POST', headers: visitorHeaders, body: '{}' })
      expect(response.status, path).toBe(template.elsewhere.status)
      if (template.elsewhere.body !== undefined) expect(await response.text(), path).toBe(template.elsewhere.body)
    }
    expect(stub.seen).toHaveLength(0)
  })

  it('forwards nothing for a request target that only resolves to the issued path', async () => {
    stub.seen = []
    for (const target of NEAR_TARGETS.filter((near) => !template.resolvedInFront?.includes(near))) {
      const response = await rawPost(proxy!.base, target)
      expect.soft(response.body, target).not.toBe('{"request_id":"req_stub"}')
      expect.soft(stub.seen.splice(0).map((seen) => seen.url), target).toEqual([])
    }
    // The query string is not part of the path.
    expect((await rawPost(proxy!.base, '/k7x2qm4a?v=1')).status).toBe(200)
  })

  it('answers 405 with Allow: POST for every other method', async () => {
    stub.seen = []
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
      const response = await fetch(`${proxy!.base}/k7x2qm4a`, { method })
      expect(response.status, method).toBe(405)
      expect(response.headers.get('allow')).toBe('POST')
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    expect(stub.seen).toHaveLength(0)
  })

  it('refuses a body over 1 MiB', async () => {
    stub.seen = []
    const response = await fetch(`${proxy!.base}/k7x2qm4a`, {
      method: 'POST', headers: visitorHeaders, body: 'x'.repeat(1_048_577),
    })
    expect(response.status).toBe(413)
    expect(stub.seen).toHaveLength(0)
    const atCap = await fetch(`${proxy!.base}/k7x2qm4a`, { method: 'POST', headers: visitorHeaders, body: 'x'.repeat(1_048_576) })
    expect(atCap.status).toBe(200)
  })

  it('answers an API redirect or a status outside 200 to 599 with 502, never relaying Location', async () => {
    try {
      for (const status of [301, 302, 303, 304, 307, 308, 399, 600, 999]) {
        stub.status = status
        const response = await fetch(`${proxy!.base}/k7x2qm4a`, { method: 'POST', headers: visitorHeaders, body: '{}', redirect: 'manual' })
        expect(response.status, `${status}: ${proxy!.logs()}`).toBe(502)
        expect(response.headers.get('cache-control'), String(status)).toBe('no-store')
        expect(response.headers.get('location'), String(status)).toBeNull()
        expect(response.headers.get('x-request-id'), String(status)).toBeNull()
        expect(await response.text(), String(status)).not.toContain('req_stub')
      }
      for (const status of [201, 409, 500]) {
        stub.status = status
        const response = await fetch(`${proxy!.base}/k7x2qm4a`, { method: 'POST', headers: visitorHeaders, body: '{}', redirect: 'manual' })
        expect(response.status, String(status)).toBe(status)
        expect(response.headers.get('location'), String(status)).toBeNull()
        expect(response.headers.get('x-request-id'), String(status)).toBe('req_stub')
      }
    } finally {
      stub.status = 200
    }
  })

  if (template.keyless) {
    it('answers 503 rather than forwarding when the proxy key is missing', async () => {
      stub.seen = []
      const response = await fetch(`${keyless!.base}/k7x2qm4a`, { method: 'POST', headers: visitorHeaders, body: '{}' })
      expect(response.status).toBe(503)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(stub.seen).toHaveLength(0)
    })
  }

  if (template.kind === 'container') {
    it('runs as an unprivileged user', () => {
      expect(run(['exec', (proxy as Stack).name(0), 'id', '-u']).trim()).toBe('1000')
    })
  }
})
