/**
 * @vitest-environment node
 *
 * The server half.
 *
 * In the node environment, because that is where a Server Action runs and
 * because the point of this entry is that it works with no React and no DOM
 * anywhere near it.
 */

import { describe, expect, it } from 'vitest'

import { readRequestId, REQUEST_ID_FIELD } from '../src/server.js'

const form = (value: unknown): Pick<FormData, 'get'> => ({
  get: (name: string) => (name === REQUEST_ID_FIELD ? (value as string) : null),
})

describe('readRequestId', () => {
  it('reads the field the client component writes', () => {
    expect(readRequestId(form('req_01JABCDEF'))).toBe('req_01JABCDEF')
  })

  it('reads a renamed field', () => {
    const named: Pick<FormData, 'get'> = { get: (name) => (name === 'risk_ref' ? 'req_2' : null) }
    expect(readRequestId(named, { name: 'risk_ref' })).toBe('req_2')
  })

  it('returns null for a form that carried no identification', () => {
    // All three mean the same thing to a caller: this submission has no
    // identification attached. A form submitted before the SDK finished, or
    // with JavaScript disabled, is a normal event rather than an error.
    expect(readRequestId(form(null))).toBeNull()
    expect(readRequestId(form(''))).toBeNull()
    expect(readRequestId(form('   '))).toBeNull()
  })

  it('returns null for a value that is not a string', () => {
    // What a file input in the same form would produce.
    expect(readRequestId(form({ name: 'upload.png' }))).toBeNull()
  })

  it('refuses anything that is not an opaque token', () => {
    // The field arrives from the page, which means it arrives from whoever is
    // driving the browser. A server that joins or logs it unchecked is one
    // hand-written input away from storing what the visitor typed.
    expect(readRequestId(form('req_1 OR 1=1'))).toBeNull()
    expect(readRequestId(form('<script>alert(1)</script>'))).toBeNull()
    expect(readRequestId(form('req/../../etc/passwd'))).toBeNull()
    expect(readRequestId(form('r'.repeat(129)))).toBeNull()
    expect(readRequestId(form('r'.repeat(128)))).toBe('r'.repeat(128))
  })

  it('trims, because a hand-built form field arrives with whitespace', () => {
    expect(readRequestId(form('  req_3\n'))).toBe('req_3')
  })
})
