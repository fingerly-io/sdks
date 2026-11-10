/**
 * The demo page writes report values with innerHTML, and those values come
 * from the visitor's browser: a user-agent string carrying markup ran as
 * script in the demo until every interpolation went through `esc`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const page = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'demo', 'index.html'), 'utf8')

describe('demo/index.html', () => {
  it('escapes source values before writing them to innerHTML', () => {
    expect(page).toMatch(/const esc = \(value\)/)
    expect(page).not.toMatch(/<td>\$\{value/)
    expect(page).toMatch(/<td>\$\{esc\(value/)
  })

  it('escapes the integrity findings it lists', () => {
    expect(page).toMatch(/patched_natives\.map\(esc\)/)
  })
})
