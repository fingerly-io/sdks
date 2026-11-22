/**
 * Serves the interaction capture page and saves each capture it posts.
 *
 * Not part of any package: there is no package.json here, so the workspace,
 * the build and the published tarballs never see this directory.
 *
 *   node client/web/capture/serve.mjs        (from the sdks repository root)
 *
 * GET  /           the task page
 * GET  /sdk.js     the locally built script-tag SDK (web-js/dist/browser.global.js)
 * POST /capture    { label, notes, ended_by, started, task, user_agent, interaction, automation }
 *                  saved as captures/<time>-<label>.json, never overwriting one
 *
 * PORT (default 3034) and HOST (default 127.0.0.1) can be set in the
 * environment. HOST=0.0.0.0 lets a phone on the same network open the page
 * for touch runs; only do that on a network you trust.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sdkPath = join(here, '..', 'web-js', 'dist', 'browser.global.js')
const pagePath = join(here, 'index.html')
const capturesDir = join(here, 'captures')
const port = Number(process.env.PORT ?? 3034)
const host = process.env.HOST ?? '127.0.0.1'
const MAX_BODY_BYTES = 64 * 1024

function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store, max-age=0' })
  response.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

/** The interaction counts, refused unless every value is a whole number. */
function countsOf(outcome) {
  if (!outcome || outcome.status !== 'ok' || typeof outcome.value !== 'object' || outcome.value === null) {
    return undefined
  }
  const entries = Object.entries(outcome.value)
  if (entries.length === 0 || !entries.every(([, value]) => Number.isInteger(value) && value >= 0)) {
    return undefined
  }
  return Object.fromEntries(entries)
}

function slug(label) {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'unlabelled'
  )
}

async function saveCapture(request, response) {
  // The page posts from its own origin. A browser names the origin of every
  // cross-origin POST, so another site's page cannot write captures here.
  const origin = request.headers.origin
  if (origin !== undefined && origin !== `http://${request.headers.host}`) {
    send(response, 403, { error: 'cross-origin capture refused' })
    return
  }
  let body
  try {
    body = JSON.parse(await readBody(request))
  } catch {
    send(response, 400, { error: 'expected a JSON body under 64 KB' })
    return
  }
  const label = typeof body?.label === 'string' ? body.label.trim().slice(0, 200) : ''
  if (label === '') {
    send(response, 400, { error: 'a label is required' })
    return
  }
  const interaction = countsOf(body.interaction)
  if (!interaction) {
    send(response, 400, {
      error: 'no interaction counts: rebuild web-js and reload the page',
      received: body.interaction ?? null,
    })
    return
  }

  const capturedAt = new Date()
  const capture = {
    label,
    notes: typeof body.notes === 'string' ? body.notes.slice(0, 2000) : '',
    captured_at: capturedAt.toISOString(),
    ended_by: body.ended_by === 'finish' ? 'finish' : 'operator',
    started_by_operator: body.started === true,
    task: typeof body.task === 'object' && body.task !== null ? body.task : {},
    user_agent: typeof body.user_agent === 'string' ? body.user_agent.slice(0, 500) : '',
    interaction,
    automation: body.automation ?? null,
  }

  await mkdir(capturesDir, { recursive: true })
  const stamp = capturedAt.toISOString().replace(/[:.]/g, '-')
  const name = `${stamp}-${slug(label)}-${randomBytes(2).toString('hex')}.json`
  // `wx`: a capture is never overwritten, only added.
  await writeFile(join(capturesDir, name), `${JSON.stringify(capture, null, 2)}\n`, { flag: 'wx' })
  console.log(`saved captures/${name}`)
  send(response, 201, { saved: `captures/${name}`, capture })
}

createServer(async (request, response) => {
  const path = (request.url ?? '/').split('?')[0]
  try {
    if (request.method === 'GET' && (path === '/' || path === '/index.html')) {
      send(response, 200, await readFile(pagePath), 'text/html; charset=utf-8')
    } else if (request.method === 'GET' && path === '/sdk.js') {
      try {
        send(response, 200, await readFile(sdkPath), 'text/javascript; charset=utf-8')
      } catch {
        send(response, 404, 'web-js is not built: see capture/README.md', 'text/plain; charset=utf-8')
      }
    } else if (request.method === 'POST' && path === '/capture') {
      await saveCapture(request, response)
    } else {
      send(response, 404, { error: 'not found' })
    }
  } catch (error) {
    console.error(error)
    if (!response.headersSent) send(response, 500, { error: 'capture failed' })
  }
}).listen(port, host, () => {
  console.log(`fingerly interaction capture: http://localhost:${port}/ (listening on ${host})`)
})
