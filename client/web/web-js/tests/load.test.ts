// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { load, TransportError } from '../src/index.js'

describe('load()', () => {
  it('rejects a configuration mistake instead of throwing synchronously', async () => {
    let result: Promise<unknown> | undefined
    expect(() => {
      result = load({ apiKey: '' })
    }).not.toThrow()
    await expect(result).rejects.toBeInstanceOf(TransportError)
  })

  it('rejects conflicting endpoint options the same way', async () => {
    let result: Promise<unknown> | undefined
    expect(() => {
      result = load({ apiKey: 'fly_pk_development_test', endpoint: '/a', endpoints: '/b' })
    }).not.toThrow()
    await expect(result).rejects.toBeInstanceOf(TypeError)
  })
})
