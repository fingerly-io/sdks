/**
 * A static server for the demo page.
 *
 * `file://` will not do: several of the sources need a secure context - the
 * storage estimate, the permissions query, the service-worker check - and a
 * page opened from disk is not one, so the report would be missing exactly the
 * signals worth looking at. `localhost` counts as secure.
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const port = Number(process.env.PORT ?? 4173)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

createServer(async (request, response) => {
  const path = (request.url ?? '/').split('?')[0]
  const relative = path === '/' ? 'demo/index.html' : normalize(path).replace(/^(\.\.[/\\])+/, '')
  const file = join(root, relative)

  // Do not serve outside the package, whatever the request path says.
  if (!file.startsWith(root)) {
    response.writeHead(403).end('forbidden')
    return
  }

  try {
    const body = await readFile(file)
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      // Never cached, and the reason is worth the header. The bundle this
      // serves is rebuilt while the page is open, and a browser heuristically
      // caching it means a rebuild that appears to have done nothing - the
      // detector still answers with the logic you just replaced, and the time
      // goes into debugging the change rather than the bug.
      'cache-control': 'no-store, max-age=0',
    })
    response.end(body)
  } catch {
    response.writeHead(404).end('not found')
  }
}).listen(port, () => {
  console.log(`badele demo: http://localhost:${port}/`)
})
