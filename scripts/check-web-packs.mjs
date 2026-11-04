#!/usr/bin/env node
// Packs every browser package the way it is published (pnpm pack, which
// rewrites `workspace:` ranges) and fails when a tarball would not install
// for a customer: a `workspace:` range left in its dependencies, a source map,
// TypeScript source, tests, or a missing LICENSE or README.
//
// `npm pack` and `npm publish` do not rewrite `workspace:` ranges. Publish
// these packages with `pnpm publish` only; this check is what proves the
// result.
//
//   node scripts/check-web-packs.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const packages = ['types', 'core', 'web-js', 'react', 'vue', 'svelte', 'angular', 'next', 'nuxt']
const out = mkdtempSync(join(tmpdir(), 'fingerly-packs-'))
const problems = []

try {
  for (const name of packages) {
    const dir = join(root, 'client/web', name)
    execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd: dir, stdio: 'ignore' })
  }
  for (const tarball of readdirSync(out).filter((file) => file.endsWith('.tgz'))) {
    const files = execFileSync('tar', ['-tzf', join(out, tarball)], { encoding: 'utf8' }).trim().split('\n')
    const manifest = JSON.parse(execFileSync('tar', ['-xOzf', join(out, tarball), 'package/package.json'], { encoding: 'utf8' }))
    for (const [dep, range] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (String(range).startsWith('workspace:')) problems.push(`${tarball}: ${dep} is still ${range}`)
    }
    for (const file of files) {
      if (/\.map$/.test(file)) problems.push(`${tarball}: ships source map ${file}`)
      if (/^package\/(src|tests?)\//.test(file)) problems.push(`${tarball}: ships ${file}`)
    }
    for (const needed of ['package/LICENSE', 'package/README.md']) {
      if (!files.includes(needed)) problems.push(`${tarball}: missing ${needed}`)
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true })
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`${packages.length} browser packages pack cleanly`)
