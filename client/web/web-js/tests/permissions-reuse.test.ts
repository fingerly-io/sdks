// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { permissionsSource } from '../src/sources/runtime.js'

afterEach(() => vi.restoreAllMocks())

describe('permissions source', () => {
  it('queries each permission once per page and reads its live state after that', async () => {
    const statuses = new Map<string, { state: string }>()
    const query = vi.fn(async ({ name }: { name: string }) => {
      const status = statuses.get(name) ?? { state: 'prompt' }
      statuses.set(name, status)
      return status
    })
    Object.defineProperty(navigator, 'permissions', { value: { query }, configurable: true })
    const ctx = { signal: new AbortController().signal, budgetRemainingMs: () => 1000, completed: () => undefined } as never

    const first = await permissionsSource.run(ctx)
    statuses.get('geolocation')!.state = 'granted'
    const second = await permissionsSource.run(ctx)

    expect(query).toHaveBeenCalledTimes(2)
    expect(first.geolocation).toBe('prompt')
    expect(second.geolocation).toBe('granted')
  })
})
