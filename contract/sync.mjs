import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = dirname(fileURLToPath(import.meta.url))
const server = resolve(process.env.FINGERLY_SERVER_DIR ?? resolve(root, '../../server'))
const check = process.argv.includes('--check')
const hash = value => createHash('sha256').update(value).digest('hex')
const files = {}
for (const [name, command] of [['openapi.json', 'openapi'], ['fixtures.json', 'sdk-fixtures']]) {
  const generated = execFileSync('go', ['run', './cmd/cli', command], { cwd: server, maxBuffer: 16 * 1024 * 1024 })
  files[name] = hash(generated)
  if (check) {
    if (!readFileSync(resolve(root, name)).equals(generated)) throw new Error(`${name} is stale; run contract sync`)
  } else writeFileSync(resolve(root, name), generated)
}
if (check) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json')))
  if (JSON.stringify(manifest.files) !== JSON.stringify(files)) throw new Error('Contract hashes do not match the snapshot')
} else {
  const serverCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: server, encoding: 'utf8' }).trim()
  writeFileSync(resolve(root, 'manifest.json'), JSON.stringify({ schema: 1, serverCommit, files }, null, 2) + '\n')
}
if (process.argv.includes('--docs-check')) {
  const docs = resolve(process.env.FINGERLY_PANELS_DIR ?? resolve(root, '../../panels'), 'apps/docs/public/openapi.json')
  if (hash(readFileSync(docs)) !== files['openapi.json']) throw new Error('Published docs OpenAPI differs from the server export')
}
console.log(check ? 'Contract snapshot matches the server.' : 'Contract snapshot refreshed.')
