// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('the published build', () => {
  it('emits no source maps, which would point at sources the package does not ship', () => {
    const config = readFileSync(new URL('../tsconfig.build.json', import.meta.url), 'utf8')
    expect(config).toMatch(/"sourceMap":\s*false/)
    expect(config).toMatch(/"declarationMap":\s*false/)
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.files).toEqual(['dist'])
  })
})
