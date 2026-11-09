#!/usr/bin/env node
// The steps of .github/workflows/release.yml.
//
//   node scripts/release-npm.mjs plan                 which versions are new
//   node scripts/release-npm.mjs constants            version constants agree
//   node scripts/release-npm.mjs pack <dir>           build tarballs and inspect them
//   node scripts/release-npm.mjs publish <dir> [--dry-run]
//   node scripts/release-npm.mjs tag <dir>            tag and GitHub Release
//
// One tag per package, `@fingerly/core@0.1.1`, because these packages version
// independently and a bare `v0.1.1` could only ever mean one of them.
//
// Environment:
//   PACKAGES        JSON array from `plan`; the other commands act on these.
//   NPM_REGISTRY_URL  Overrides the registry, for testing how an outage is handled.
//   IOS_BINARY_ZIP  Local zip used instead of downloading from maven.fingerly.io,
//                   for rehearsing `pack` before a binary has been uploaded.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const registry = process.env.NPM_REGISTRY_URL ?? 'https://registry.npmjs.org'
const repository = 'https://github.com/fingerly-io/sdks.git'

const dirs = [
  'client/web/types',
  'client/web/core',
  'client/web/web-js',
  'client/web/react',
  'client/web/vue',
  'client/web/svelte',
  'client/web/angular',
  'client/web/next',
  'client/web/nuxt',
  'server/node',
  'client/mobile/react-native',
  'client/mobile/lynx',
]

// A literal the code reports at runtime, which has to match the manifest.
const constants = [
  { dir: 'client/web/core', file: 'src/version.ts', pattern: /SDK_VERSION = '([^']+)'/ },
  { dir: 'server/node', file: 'src/proxy.ts', pattern: /PROXY_VERSION = "node\/([^"]+)"/ },
]

const fail = (message) => {
  console.error(`error: ${message}`)
  process.exit(1)
}

const manifest = (dir) => JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
const tagOf = (pkg) => `${pkg.name}@${pkg.version}`
const tarballOf = (pkg) => `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`

// Every package, dependencies before the packages that need them.
function ordered() {
  const packages = dirs.map((dir) => ({ dir, ...manifest(dir) }))
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]))
  const sorted = []
  const seen = new Set()
  const visit = (pkg) => {
    if (seen.has(pkg.name)) return
    seen.add(pkg.name)
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
      if (byName.has(dep)) visit(byName.get(dep))
    }
    sorted.push(pkg)
  }
  packages.forEach(visit)
  return sorted
}

function selected() {
  const names = JSON.parse(process.env.PACKAGES ?? 'null')
  if (!Array.isArray(names)) fail('PACKAGES is not set')
  return ordered().filter((pkg) => names.includes(pkg.name))
}

// True when the version exists or once existed. npm never lets an unpublished
// version be reused, and it stays listed in `time`. Anything but a clean answer
// throws: an outage must not look like a new version.
async function isOnRegistry(name, version) {
  const response = await fetch(`${registry}/${name.replace('/', '%2F')}`, {
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`${registry} answered ${response.status} for ${name}`)
  const packument = await response.json()
  if (!packument || typeof packument.versions !== 'object') {
    throw new Error(`${registry} sent an unreadable record for ${name}`)
  }
  return version in packument.versions || version in (packument.time ?? {})
}

function tagExists(tag) {
  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], {
      cwd: root,
      stdio: 'ignore',
    })
    return true
  } catch (error) {
    // --exit-code answers 2 for "no such ref". Anything else is a failed lookup.
    if (error.status === 2) return false
    throw new Error(`could not read tags from origin (git exited ${error.status})`)
  }
}

async function plan() {
  // Set by hand on a manual run, for a package that cannot go out yet: a first
  // publish has to precede its trusted publisher, and a package can depend on
  // a version the same run is about to release.
  const excluded = (process.env.EXCLUDE ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  const fresh = []
  for (const pkg of ordered()) {
    const published = await isOnRegistry(pkg.name, pkg.version)
    const tagged = tagExists(tagOf(pkg))
    const skipped = excluded.includes(pkg.name)
    const state = published ? 'already on npm' : tagged ? 'already tagged' : skipped ? 'excluded' : 'new'
    console.log(`${tagOf(pkg)}: ${state}`)
    if (!published && !tagged && !skipped) fresh.push(pkg.name)
  }
  const packages = JSON.stringify(fresh)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `packages=${packages}\n`)
  console.log(`packages=${packages}`)
}

function checkConstants() {
  const problems = []
  for (const { dir, file, pattern } of constants) {
    const source = readFileSync(join(root, dir, file), 'utf8')
    const found = source.match(pattern)?.[1]
    const expected = manifest(dir).version
    if (found !== expected) problems.push(`${dir}/${file} says ${found ?? 'nothing'}, package.json says ${expected}`)
  }
  if (problems.length > 0) fail(problems.join('\n'))
  console.log(`${constants.length} version constants match their manifests`)
}

// Records the checksum of the iOS binary this release ships against, so a
// customer's `pod install` can refuse anything else. Only written in CI, into
// the working copy that is about to be packed.
async function stampIosBinary(pkg) {
  const path = join(root, pkg.dir, 'ios/fingerly-binary.json')
  if (!existsSync(path)) return
  const binary = JSON.parse(readFileSync(path, 'utf8'))
  const url = `https://maven.fingerly.io/ios/Fingerly-${binary.version}.xcframework.zip`
  let bytes
  if (process.env.IOS_BINARY_ZIP) {
    bytes = readFileSync(process.env.IOS_BINARY_ZIP)
  } else {
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
    if (!response.ok) fail(`${url} answered ${response.status}. Release the iOS binary before ${pkg.name}.`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  binary.sha256 = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(path, `${JSON.stringify(binary, null, 2)}\n`)
  console.log(`${pkg.name}: pinned iOS binary ${binary.version} at ${binary.sha256}`)
}

const forbidden = [
  /\.map$/,
  /\/\.DS_Store$/,
  /^package\/(tests?|__tests__)\//,
  /^package\/node_modules\//,
  /^package\/\.turbo\//,
  /^package\/example\//,
  /^package\/android\/(build|\.gradle)\//,
  /^package\/ios\/Pods\//,
  /Frameworks\//,
  /\.xcframework/,
  /\.test\.tsx?$/,
]

function inspect(pkg, file, releasing, published) {
  const problems = []
  const files = execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).trim().split('\n')
  const packed = JSON.parse(execFileSync('tar', ['-xOzf', file, 'package/package.json'], { encoding: 'utf8' }))

  if (packed.private) problems.push('is marked private')
  if (packed.version !== pkg.version) problems.push(`has version ${packed.version}`)
  if (packed.repository?.url !== repository) problems.push(`repository.url is ${packed.repository?.url}`)
  for (const needed of ['package/LICENSE', 'package/README.md', 'package/package.json']) {
    if (!files.includes(needed)) problems.push(`is missing ${needed}`)
  }
  for (const entry of [packed.main, packed.module, packed.types].filter(Boolean)) {
    const inside = `package/${entry.replace(/^\.\//, '')}`
    if (!files.includes(inside)) problems.push(`is missing its entry point ${inside}`)
  }
  for (const path of files) {
    if (forbidden.some((pattern) => pattern.test(path))) problems.push(`ships ${path}`)
    // Lynx ships TypeScript source by design: its bundler compiles it.
    if (pkg.name !== '@fingerly/lynx' && path.startsWith('package/src/')) problems.push(`ships ${path}`)
  }

  const siblings = new Map(ordered().map((sibling) => [sibling.name, sibling]))
  for (const [dep, range] of Object.entries({ ...packed.dependencies, ...packed.peerDependencies })) {
    if (String(range).startsWith('workspace:')) problems.push(`${dep} is still ${range}`)
    const sibling = siblings.get(dep)
    if (!sibling) continue
    if (range !== sibling.version) problems.push(`needs ${dep}@${range} but the workspace has ${sibling.version}`)
    if (!releasing.has(dep) && !published.has(dep)) problems.push(`needs ${dep}@${range}, which is neither on npm nor in this release`)
  }

  const binaryFile = 'package/ios/fingerly-binary.json'
  if (files.includes(binaryFile)) {
    const binary = JSON.parse(execFileSync('tar', ['-xOzf', file, binaryFile], { encoding: 'utf8' }))
    if (!/^[0-9a-f]{64}$/.test(binary.sha256 ?? '')) problems.push('has no iOS binary checksum')
  }
  return problems.map((problem) => `${tarballOf(pkg)} ${problem}`)
}

async function pack(dir) {
  mkdirSync(dir, { recursive: true })
  const packages = selected()
  const releasing = new Set(packages.map((pkg) => pkg.name))

  const published = new Set()
  for (const pkg of ordered()) {
    if (!releasing.has(pkg.name) && (await isOnRegistry(pkg.name, pkg.version))) published.add(pkg.name)
  }

  const problems = []
  for (const pkg of packages) {
    await stampIosBinary(pkg)
    execFileSync('pnpm', ['pack', '--pack-destination', resolve(dir)], {
      cwd: join(root, pkg.dir),
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    problems.push(...inspect(pkg, join(dir, tarballOf(pkg)), releasing, published))
  }
  if (problems.length > 0) fail(problems.join('\n'))
  console.log(`${packages.length} tarballs inspected`)
}

function publish(dir, dryRun) {
  const record = join(dir, 'published.txt')
  for (const pkg of selected()) {
    // Absolute: npm reads a relative `dir/file.tgz` as a GitHub shorthand.
    const args = ['publish', resolve(dir, tarballOf(pkg)), '--access', 'public']
    args.push(...(dryRun ? ['--dry-run'] : ['--provenance']))
    execFileSync('npm', args, { cwd: root, stdio: 'inherit' })
    if (!dryRun) appendFileSync(record, `${pkg.name}\n`)
    console.log(`${dryRun ? 'dry run' : 'published'}: ${tagOf(pkg)}`)
  }
}

function tag(dir) {
  const names = readFileSync(join(dir, 'published.txt'), 'utf8').trim().split('\n')
  for (const pkg of ordered().filter((candidate) => names.includes(candidate.name))) {
    const name = tagOf(pkg)
    execFileSync(
      'gh',
      [
        'release', 'create', name,
        '--target', process.env.GITHUB_SHA,
        '--title', name,
        '--notes', `Published to npm: https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`,
      ],
      { cwd: root, stdio: 'inherit' },
    )
  }
}

const [command, dir, flag] = process.argv.slice(2)
try {
  if (command === 'plan') await plan()
  else if (command === 'constants') checkConstants()
  else if (command === 'pack' && dir) await pack(dir)
  else if (command === 'publish' && dir) publish(dir, flag === '--dry-run')
  else if (command === 'tag' && dir) tag(dir)
  else fail(`unknown command: ${process.argv.slice(2).join(' ')}`)
} catch (error) {
  fail(error.message)
}
