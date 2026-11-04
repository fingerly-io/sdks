/**
 * Checks on the shipped files themselves: the console snippets match them, the
 * wording rules hold, and every template reports the same version.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

type Snippets = Record<string, { steps: Array<Record<string, string>> }>

/** The fenced code blocks of a Markdown file, with their list indentation removed. */
function codeBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^( *)```[^\n]*\n([\s\S]*?)^\1```$/gm)].map(([, indent, body]) =>
    body!.split('\n').map((line) => line.slice(indent!.length)).join('\n'),
  )
}

/**
 * The dashboard steps that put the proxy key in place, per template. Each one's
 * code must appear in that template's README as a code block, verbatim, so the
 * two never teach different ways of handling the key.
 */
const KEY_STEPS: Record<string, string[]> = {
  nginx: ['Store the proxy key'],
  container: ['Store the proxy key', 'Run it'],
}

/**
 * The steps that prompt for the key, run for real with the key on stdin: the
 * file they write, relative to the folder they run in once `sudo`, root
 * ownership and absolute paths are taken out, and what it must hold.
 */
const PROMPTED: Array<{ kind: string; title: string; file: string; holds: (key: string) => string }> = [
  { kind: 'nginx', title: 'Store the proxy key', file: 'fingerly-proxy-key.conf', holds: (key) => `set $fingerly_proxy_key "${key}";\n` },
  { kind: 'container', title: 'Store the proxy key', file: 'site-relay.env', holds: (key) => `FINGERLY_PROXY_KEY=${key}\n` },
]

const SHELLS = ['bash', 'zsh'].filter((shell) => spawnSync(shell, ['-c', 'true']).status === 0)

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

  it('the Vercel README and the dashboard add the proxy key with the same command', () => {
    const snippets = JSON.parse(readFileSync(OUTPUT, 'utf8')) as Record<string, { steps: Array<Record<string, string>> }>
    const command = snippets.vercel!.steps.find((step) => step.title === 'Add the proxy key')?.code?.trim()
    expect(command).toBe('vercel env add FINGERLY_PROXY_KEY production --sensitive')
    const readme = readFileSync(join(ROOT, 'vercel/README.md'), 'utf8')
    expect(readme.match(/^\s*vercel env add .*$/gm)?.map((line) => line.trim())).toEqual([command])
  })

  it('the Netlify README and the dashboard add the proxy key the same way, never on a command line', () => {
    const snippets = JSON.parse(readFileSync(OUTPUT, 'utf8')) as Record<string, { steps: Array<Record<string, string>> }>
    const step = snippets.netlify!.steps.find((each) => each.title === 'Add the proxy key')
    expect(step?.label).toBe('Project configuration > Environment variables')
    expect(step?.code).toBe('Key:    FINGERLY_PROXY_KEY\nValue:  fly_px_production_…\nScopes: Functions\n')
    const readme = readFileSync(join(ROOT, 'netlify/README.md'), 'utf8')
    expect(readme).toContain('**Project configuration > Environment')
    const block = readme.match(/```text\n((?:\s*\S.*\n)+?)\s*```/)?.[1]
    expect(block?.split('\n').map((line) => line.trim()).join('\n')).toBe(step?.code?.replace('fly_px_production_…', 'fly_px_production_...'))
    // No command that carries the key as an argument, in either place.
    for (const text of [readme, ...snippets.netlify!.steps.map((each) => each.code)]) {
      expect(text).not.toMatch(/^\s*(netlify\s+env:(set|import)|ntl\s+env:)/m)
      expect(text).not.toMatch(/env:set\s+FINGERLY_PROXY_KEY\s+\S/)
    }
  })

  it.each(Object.entries(KEY_STEPS))('the %s README and the dashboard put the proxy key in place with the same commands', (kind, titles) => {
    const snippets = JSON.parse(readFileSync(OUTPUT, 'utf8')) as Snippets
    const blocks = codeBlocks(readFileSync(join(ROOT, kind, 'README.md'), 'utf8'))
    for (const title of titles) {
      const step = snippets[kind]!.steps.find((each) => each.title === title)
      expect(step, `${kind}: ${title}`).toBeDefined()
      expect(blocks, `${kind}: ${title}`).toContain(step!.code)
    }
  })

  it.each(PROMPTED)('the $kind step "$title" writes the key it was given at the prompt, readable only by its owner', ({ kind, title, file, holds }) => {
    const snippets = JSON.parse(readFileSync(OUTPUT, 'utf8')) as Snippets
    const code = snippets[kind]!.steps.find((each) => each.title === title)!.code!
    const local = code.replaceAll('sudo ', '').replaceAll(' -o root -g root', '').replace(/\/etc\/\w+\//g, '')
    const key = 'fly_px_production_k3yFromThePrompt'
    expect(SHELLS.length).toBeGreaterThan(0)
    for (const shell of SHELLS) {
      const dir = mkdtempSync(join(tmpdir(), 'prompted-'))
      try {
        // A stale file with open permissions, as a second run would find.
        writeFileSync(join(dir, file), 'stale\n', { mode: 0o644 })
        const run = spawnSync(shell, ['-c', local], { cwd: dir, input: `${key}\n`, encoding: 'utf8' })
        expect(run.status, `${shell}: ${run.stderr}`).toBe(0)
        expect(run.stdout, shell).not.toContain(key)
        expect(readFileSync(join(dir, file), 'utf8'), shell).toBe(holds(key))
        expect(statSync(join(dir, file)).mode & 0o777, shell).toBe(0o600)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
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
