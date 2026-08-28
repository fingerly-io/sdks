/**
 * A static server for the React demo.
 *
 * `file://` will not do: several of the sources the binding drives need a
 * secure context - the storage estimate, the origin private file system probe
 * the incognito verdict rests on, the permissions query - and a page opened
 * from disk is not one, so the report would be missing exactly the signals
 * worth looking at. `localhost` counts as secure.
 *
 * Port 4175, so this, the Vue demo on 4174 and the web-js demo on 4173 can be
 * open beside each other and compared.
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const port = Number(process.env.PORT ?? 4175)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

createServer(async (request, response) => {
  const path = (request.url ?? '/').split('?')[0]
  const relative = path === '/' ? 'index.html' : normalize(path).replace(/^(\.\.[/\\])+/, '')
  const file = join(root, relative)

  // Do not serve outside the demo directory, whatever the request path says.
  if (!file.startsWith(root)) {
    response.writeHead(403).end('forbidden')
    return
  }

  try {
    const body = await readFile(file)
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      // Never cached. The bundle this serves is rebuilt while the page is
      // open, and a browser holding on to the old one means a rebuild that
      // appears to have done nothing - the verdicts still come from the logic
      // you just replaced, and the time goes into debugging the change rather
      // than the bug.
      'cache-control': 'no-store, max-age=0',
    })
    response.end(body)
  } catch {
    response.writeHead(404).end('not found')
  }
}).listen(port, () => {
  console.log(`badele react demo: http://localhost:${port}/`)
})
