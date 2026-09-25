/**
 * Checks on the shipped files themselves: the console snippets match them, the
 * wording rules hold, and every template reports the same version.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OUTPUT, render } from '../scripts/console-snippets.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const TEMPLATES = ['nginx', 'caddy', 'vercel', 'netlify', 'aws-cloudfront', 'gcp-cloud-run', 'container', 'traefik']

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return []
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const shipped = [...TEMPLATES.flatMap((name) => files(join(ROOT, name))), join(ROOT, 'README.md'), join(ROOT, 'console-snippets.json')]

describe('shipped files', () => {
  it('console-snippets.json is generated from the current templates', () => {
    expect(readFileSync(OUTPUT, 'utf8')).toBe(render())
  })

  it('console snippets use only the dashboard placeholders for path and key', () => {
    const snippets = JSON.parse(readFileSync(OUTPUT, 'utf8')) as Record<string, { steps: Array<Record<string, string>> }>
    expect(Object.keys(snippets).sort()).toEqual([...TEMPLATES].sort())
    for (const [kind, { steps }] of Object.entries(snippets)) {
      for (const step of steps) {
        expect(Object.keys(step).sort(), kind).toEqual(['code', 'label', 'text', 'title'])
        const text = `${step.text}\n${step.code}`
        for (const key of text.match(/fly_px_production_\S*/g) ?? []) expect(key, kind).toMatch(/^fly_px_production_…/)
      }
      expect(steps.map((step) => step.code).join('\n'), kind).toContain('/k7x2qm4a')
    }
  })

  it('contain no em or en dashes', () => {
    for (const path of shipped) {
      expect(readFileSync(path, 'utf8'), relative(ROOT, path)).not.toMatch(/[\u2013\u2014]/)
    }
  })

  it('never hard-code a proxy key', () => {
    for (const path of shipped) {
      expect(readFileSync(path, 'utf8'), relative(ROOT, path)).not.toMatch(/fly_px_(production|staging|development)_[A-Za-z0-9]/)
    }
  })

  it('all report version 1.0.0 under their own kind', () => {
    const version = (path: string) => readFileSync(join(ROOT, path), 'utf8')
    expect(version('nginx/fingerly.conf')).toContain('"nginx/1.0.0"')
    expect(version('caddy/Caddyfile')).toContain('caddy/1.0.0')
    for (const path of ['vercel/middleware.ts', 'netlify/edge-functions/relay.ts', 'container/server.mjs', 'gcp-cloud-run/server.mjs', 'aws-cloudfront/function.js']) {
      expect(version(path), path).toMatch(/VERSION = '1\.0\.0'/)
    }
    expect(JSON.parse(version('gcp-cloud-run/package.json')).version).toBe('1.0.0')
  })

  it('keep the one upstream', () => {
    for (const path of ['nginx/fingerly.conf', 'vercel/middleware.ts', 'netlify/edge-functions/relay.ts', 'container/server.mjs', 'gcp-cloud-run/server.mjs']) {
      expect(readFileSync(join(ROOT, path), 'utf8'), path).toContain('https://api.fingerly.io/api/v1/ingest')
    }
    expect(readFileSync(join(ROOT, 'caddy/Caddyfile'), 'utf8')).toContain('reverse_proxy https://api.fingerly.io {')
    expect(readFileSync(join(ROOT, 'aws-cloudfront/cloudformation.yaml'), 'utf8')).toContain('DomainName: api.fingerly.io')
  })
})
