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
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
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

/** The stub API: records every request and answers like the real one, plus a cookie and a cache header. */
class StubApi {
  seen: Seen[] = []
  private server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      this.seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString() })
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-request-id': 'req_stub',
        'ratelimit-limit': '100',
        'ratelimit-remaining': '99',
        'set-cookie': 'session=abc; Path=/',
        'cache-control': 'max-age=60',
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
  for (;;) {
    try {
      if (ready(await fetch(`${deployment.base}${path}`))) return
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`the deployment did not become ready:\n${deployment.logs()}`)
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
    this.base = `http://${run(['port', this.names[0]!, `${this.port}/tcp`]).trim().split('\n')[0]}`
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
    this.base = `http://${this.compose(['port', this.front.service, String(this.front.port)]).trim().split('\n')[0]}`
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

/** The environment a template's own files tell the container to use. */
function relayEnv(key: string, source?: string): string[] {
  return [
    '-e', 'FINGERLY_PATH=/k7x2qm4a',
    ...(key ? ['-e', `FINGERLY_PROXY_KEY=${key}`] : []),
    ...(source ? ['-e', `FINGERLY_CLIENT_IP_SOURCE=${source}`] : []),
  ]
}

/** FINGERLY_CLIENT_IP_SOURCE as the shipped docker-compose.yml sets it. */
function composeClientIpSource(): string {
  const match = /FINGERLY_CLIENT_IP_SOURCE: (\S+)/.exec(readFileSync(join(ROOT, 'traefik/docker-compose.yml'), 'utf8'))
  if (!match) throw new Error('traefik/docker-compose.yml no longer sets FINGERLY_CLIENT_IP_SOURCE')
  return match[1]!
}

const relayReady = { path: '/k7x2qm4a', when: (response: Response) => response.status === 405 }

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
  /** The origin sent upstream when the client sends none. */
  originFallback(base: string): string
}

const templates: Template[] = [
  {
    kind: 'nginx',
    version: 'nginx/1.0.0',
    keyless: true,
    deploy(stubPort, dir, key) {
      const shipped = readFileSync(join(ROOT, 'nginx/fingerly.conf'), 'utf8')
      if (!shipped.includes(SHIPPED_UPSTREAM_NGINX)) throw new Error('the shipped nginx template no longer names the API upstream')
      const n = id()
      writeFileSync(join(dir, `fingerly-${n}.conf`), shipped.replace(SHIPPED_UPSTREAM_NGINX, `proxy_pass http://host.docker.internal:${stubPort}/api/v1/ingest;`))
      writeFileSync(join(dir, `key-${n}.conf`), `set $fingerly_proxy_key "${key}";\n`)
      writeFileSync(join(dir, `site-${n}.conf`), 'server {\n    listen 8080;\n    include /etc/nginx/snippets/fingerly.conf;\n    location / { return 200 "site"; }\n}\n')
      return new Stack([{
        args: [
          '-v', `${join(dir, `site-${n}.conf`)}:/etc/nginx/conf.d/default.conf:ro`,
          '-v', `${join(dir, `fingerly-${n}.conf`)}:/etc/nginx/snippets/fingerly.conf:ro`,
          '-v', `${join(dir, `key-${n}.conf`)}:/etc/nginx/fingerly-proxy-key.conf:ro`,
          'nginx:alpine',
        ],
      }], 8080)
    },
    upstreamHost: () => 'api.fingerly.io',
    elsewhere: { status: 200, body: 'site' },
    originFallback: (base) => base,
  },
  {
    kind: 'caddy',
    version: 'caddy/1.0.0',
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
        args: [...(key ? ['-e', `FINGERLY_PROXY_KEY=${key}`] : []), '-v', `${file}:/etc/caddy/Caddyfile:ro`, 'caddy:alpine'],
      }], 8080)
    },
    upstreamHost: (stubPort) => `host.docker.internal:${stubPort}`,
    elsewhere: { status: 200, body: 'site' },
    originFallback: (base) => base,
  },
  {
    kind: 'container',
    version: 'container/1.0.0',
    keyless: true,
    // Reached directly, so the default source, the connection itself.
    deploy: (stubPort, dir, key) => new Stack([{ args: [...relayEnv(key), relayImage(dir, stubPort)] }], 8080, relayReady),
    upstreamHost: (stubPort) => `host.docker.internal:${stubPort}`,
    elsewhere: { status: 404 },
    originFallback: (base) => base.replace('http:', 'https:'),
  },
  {
    kind: 'traefik (file provider)',
    version: 'container/1.0.0',
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
        { alias: 'site-relay', args: [...relayEnv(key, composeClientIpSource()), relayImage(dir, stubPort)] },
      ], 8080, relayReady)
    },
    upstreamHost: (stubPort) => `host.docker.internal:${stubPort}`,
    elsewhere: { status: 502 },
    originFallback: (base) => base.replace('http:', 'https:'),
  },
  {
    kind: 'traefik (docker-compose labels)',
    version: 'container/1.0.0',
    keyless: false,
    deploy(stubPort, dir, key) {
      const project = join(dir, `compose-${id()}`)
      mkdirSync(project)
      copyFileSync(join(ROOT, 'traefik/docker-compose.yml'), join(project, 'docker-compose.yml'))
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
      return new Compose(project, ['docker-compose.yml', 'traefik.yml'], { FINGERLY_PROXY_KEY: key }, { service: 'traefik', port: 8080 }, relayReady)
    },
    upstreamHost: (stubPort) => `host.docker.internal:${stubPort}`,
    elsewhere: { status: 404 },
    originFallback: (base) => base.replace('http:', 'https:'),
  },
]

const visitorHeaders = {
  'content-type': 'application/json',
  'x-api-key': 'fly_pk_production_public',
  'idempotency-key': 'op-1',
  origin: 'https://shop.example',
  'user-agent': 'Mozilla/5.0 (integration)',
  cookie: 'session=1',
  authorization: 'Bearer secret',
  'x-forwarded-for': '6.6.6.6',
  'x-real-ip': '6.6.6.6',
  'x-fingerly-client-ip': '6.6.6.6',
  'x-fingerly-proxy-key': 'fly_px_production_forged',
  'x-fingerly-proxy-version': 'forged/9.9.9',
  'x-fingerly-other': 'forged',
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

  it('forwards to the ingest URL with the visitor metadata, overwriting what the visitor sent', async () => {
    stub.seen = []
    const response = await fetch(`${proxy!.base}/k7x2qm4a`, { method: 'POST', headers: visitorHeaders, body: '{"a":1}' })
    expect(response.status, proxy!.logs()).toBe(200)
    expect(stub.seen).toHaveLength(1)
    const seen = stub.seen[0]!
    expect(seen.method).toBe('POST')
    expect(seen.url).toBe('/api/v1/ingest')
    expect(seen.body).toBe('{"a":1}')
    expect(seen.headers.host).toBe(template.upstreamHost(stubPort))
    expect(seen.headers['content-type']).toBe('application/json')
    expect(seen.headers['x-api-key']).toBe('fly_pk_production_public')
    expect(seen.headers['idempotency-key']).toBe('op-1')
    expect(seen.headers['x-fingerly-proxy-key']).toBe(KEY)
    expect(seen.headers['x-fingerly-proxy-version']).toBe(template.version)
    expect(seen.headers['x-fingerly-origin']).toBe('https://shop.example')
    expect(seen.headers['x-fingerly-user-agent']).toBe('Mozilla/5.0 (integration)')
    // The address of the connection the front server accepted: never a forged header.
    expect(seen.headers['x-fingerly-client-ip']).toMatch(/^[0-9a-f.:]+$/)
    expect(seen.headers['x-fingerly-client-ip']).not.toBe('6.6.6.6')
    expect(seen.headers['x-fingerly-other']).toBeUndefined()
    expect(seen.headers.cookie).toBeUndefined()
    expect(seen.headers.authorization).toBeUndefined()
  })

  it('relays the request id and rate limits, drops cookies and pins no-store', async () => {
    const response = await fetch(`${proxy!.base}/k7x2qm4a`, { method: 'POST', headers: visitorHeaders, body: '{}' })
    expect(response.headers.get('x-request-id')).toBe('req_stub')
    expect(response.headers.get('ratelimit-remaining')).toBe('99')
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('{"request_id":"req_stub"}')
  })

  it("uses the page's own origin when the client sends none", async () => {
    stub.seen = []
    const { origin: _origin, ...withoutOrigin } = visitorHeaders
    await fetch(`${proxy!.base}/k7x2qm4a`, { method: 'POST', headers: withoutOrigin, body: '{}' })
    expect(stub.seen[0]?.headers['x-fingerly-origin']).toBe(template.originFallback(proxy!.base))
  })

  it('answers exactly the issued path', async () => {
    stub.seen = []
    for (const path of ['/k7x2qm4a/admin', '/k7x2qm4ab', '/other']) {
      const response = await fetch(`${proxy!.base}${path}`, { method: 'POST', headers: visitorHeaders, body: '{}' })
      expect(response.status, path).toBe(template.elsewhere.status)
      if (template.elsewhere.body !== undefined) expect(await response.text(), path).toBe(template.elsewhere.body)
    }
    expect(stub.seen).toHaveLength(0)
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

  it.skipIf(!template.keyless)('answers 503 rather than forwarding when the proxy key is missing', async () => {
    stub.seen = []
    const response = await fetch(`${keyless!.base}/k7x2qm4a`, { method: 'POST', headers: visitorHeaders, body: '{}' })
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(stub.seen).toHaveLength(0)
  })

  it.skipIf(template.kind !== 'container')('runs as an unprivileged user', () => {
    expect(run(['exec', (proxy as Stack).name(0), 'id', '-u']).trim()).toBe('1000')
  })
})
