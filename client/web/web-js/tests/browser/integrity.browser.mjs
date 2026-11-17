// Browser regression checks for WEB-03, WEB-04, WEB-07 and WEB-10, run in a
// real headless Chromium against the script-tag bundle. Local only: the page
// is served from 127.0.0.1, every other host name is unresolvable, and
// identify() posts to a local stub.
//
// Not part of `vitest run`, because it needs a browser binary:
//
//   node tests/browser/integrity.browser.mjs <dist/browser.global.js> <chrome-headless-shell>
//
// Exits 1 when any check fails.

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [bundlePath, chromePath] = process.argv.slice(2)
if (!bundlePath || !chromePath) {
  console.error('usage: node integrity.browser.mjs <browser.global.js> <chrome-headless-shell>')
  process.exit(2)
}
const bundle = readFileSync(bundlePath)
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="worker-src 'none'">`

const COLLECT_WORKER = `
  const client = await Fingerly.load({ apiKey: 'fly_pk_development_test', consent: 'granted', endpoints: location.origin + '/ingest' })
  const wr = (await client.collect()).sources.worker_realm
  out.worker_realm = { status: wr.status, reason: wr.reason }
`

const PAGES = [
  {
    name: 'WEB-04 integrity layer',
    body: `
      const brief = (r) => r.lies.filter((l) => l.kind !== 'missing')
      out.baseline = brief(Fingerly.inspectIntegrity({}))
      const navDesc = Object.getOwnPropertyDescriptor(window, 'navigator')
      const wrapped = new Proxy(navigator, { get: (t, p) => (p === 'userAgent' ? 'CHANGED-UA' : Reflect.get(t, p, t)) })
      Object.defineProperty(window, 'navigator', { configurable: true, get: () => wrapped })
      out.wrapped = brief(Fingerly.inspectIntegrity({}))
      Object.defineProperty(window, 'navigator', navDesc)
      const cwDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')
      out.substitute_calls = 0
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        configurable: true,
        get: () => ({ Function: { prototype: { toString() { out.substitute_calls++; return 'function x() { [native code] }' } } } }),
      })
      out.borrowed = brief(Fingerly.inspectIntegrity({}))
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', cwDesc)
      const client = await Fingerly.load({ apiKey: 'fly_pk_development_test', consent: 'granted', endpoints: location.origin + '/ingest', sources: [] })
      Object.defineProperty(document, 'body', { configurable: true, get() { throw new Error('body getter') } })
      try { await client.identify(); out.body_getter = 'resolved' } catch (e) { out.body_getter = 'rejected' }
      delete document.body
    `,
    check: (r) => [
      ['no lies on a clean page', r.baseline?.length === 0],
      ['a wrapped navigator is reported', (r.wrapped ?? []).length > 0],
      ['a replaced contentWindow leaves the realm unverified', (r.borrowed ?? []).some((l) => l.kind === 'unverified_realm')],
      ['the substitute stringifier is never used', r.substitute_calls === 0],
      ['a throwing getter does not reject identify()', r.body_getter === 'resolved'],
    ],
  },
  {
    name: 'WEB-03 CSP meta in <head>',
    head: CSP_META,
    body: COLLECT_WORKER,
    check: (r) => [['blocked: csp-meta', r.worker_realm?.status === 'blocked' && r.worker_realm?.reason === 'csp-meta']],
  },
  {
    name: 'WEB-03 CSP meta in <body>',
    bodyHtml: `<div>${CSP_META}</div>`,
    body: COLLECT_WORKER,
    check: (r) => [['a <body> meta is not trusted', r.worker_realm?.reason !== 'csp-meta']],
  },
  {
    name: 'WEB-07 embedded profile',
    before: 'window.ReactNativeWebView = { postMessage() {} }',
    body: `
      const client = await Fingerly.load({ apiKey: 'fly_pk_development_test', consent: 'granted', endpoints: location.origin + '/ingest' })
      await client.collect()
      const report = await client.collect()
      out.sources = Object.keys(report.sources).sort()
      out.wire = JSON.stringify(report)
    `,
    check: (r) => [
      ['only the embedded profile runs', JSON.stringify(r.sources) === JSON.stringify(['automation', 'embedding', 'engine', 'errors', 'math', 'navigator', 'worker_realm'])],
      ...['hardware_concurrency', 'device_memory', 'languages', 'timezone', 'unmasked_vendor', 'unmasked_renderer'].map(
        (field) => [`no ${field}`, typeof r.wire === 'string' && !r.wire.includes(`"${field}"`)],
      ),
    ],
  },
  ...[
    ['content-security-policy', 'enforced'],
    ['content-security-policy-report-only', 'report-only'],
  ].map(([header, mode]) => ({
    name: `WEB-10 strict CSP, ${mode}`,
    headers: { [header]: "script-src 'self' 'report-sample'" },
    body: `
      out.eval_violations = 0
      document.addEventListener('securitypolicyviolation', (e) => {
        if ((e.blockedURI || '') === 'eval' || /eval/.test(e.violatedDirective || '') || /script-src/.test(e.effectiveDirective || '') && e.blockedURI === 'eval') out.eval_violations++
      })
      const client = await Fingerly.load({ apiKey: 'fly_pk_development_test', consent: 'granted', endpoints: location.origin + '/ingest' })
      for (let i = 0; i < 3; i++) await client.collect()
      await new Promise((r) => setTimeout(r, 50))
    `,
    check: (r) => [['no eval violation', r.eval_violations === 0]],
  })),
]

async function runPage(page) {
  let finish
  const done = new Promise((resolve) => (finish = resolve))
  const pageJs = `(async () => { const out = {}; try { ${page.body} } catch (e) { out.error = String(e && e.stack || e) } await fetch('/result', { method: 'POST', body: JSON.stringify(out) }) })()`
  const html =
    `<!doctype html><html><head><title>t</title>${page.head ?? ''}</head><body>${page.bodyHtml ?? ''}` +
    `${page.before ? '<script src="/before.js"></script>' : ''}<script src="/bundle.js"></script><script src="/page.js"></script></body></html>`
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      if (req.url === '/') res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...(page.headers ?? {}) }).end(html)
      else if (req.url === '/bundle.js') res.writeHead(200, { 'content-type': 'text/javascript' }).end(bundle)
      else if (req.url === '/page.js') res.writeHead(200, { 'content-type': 'text/javascript' }).end(pageJs)
      else if (req.url === '/before.js') res.writeHead(200, { 'content-type': 'text/javascript' }).end(page.before)
      else if (req.url === '/result') {
        res.writeHead(204).end()
        finish(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } else if (req.url === '/ingest') res.writeHead(200, { 'content-type': 'application/json' }).end('{"request_id":"local-1"}')
      else res.writeHead(404).end()
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const profile = mkdtempSync(join(tmpdir(), 'fingerly-browser-test-'))
  const chrome = spawn(
    chromePath,
    [
      '--headless', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      `--user-data-dir=${profile}`, '--remote-debugging-port=0', `http://127.0.0.1:${server.address().port}/`,
    ],
    { stdio: 'ignore' },
  )
  const result = await Promise.race([done, new Promise((r) => setTimeout(() => r({ error: 'no result in 30s' }), 30000))])
  chrome.kill('SIGKILL')
  server.close()
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
  return result
}

let failed = 0
for (const page of PAGES) {
  const result = await runPage(page)
  if (result.error) {
    failed++
    console.log(`FAIL ${page.name}: ${result.error}`)
    continue
  }
  for (const [label, ok] of page.check(result)) {
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${page.name}: ${label}`)
  }
}
process.exit(failed === 0 ? 0 : 1)
