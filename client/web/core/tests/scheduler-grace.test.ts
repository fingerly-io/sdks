import { describe, expect, it } from 'vitest'

import { collect, DEFAULT_BUDGET_MS, DEFAULT_GRACE_MS } from '../src/scheduler.js'
import type { Source } from '../src/source.js'

// A cold browser answers its identity-critical sources late. Under the default
// budget they may run into a grace period; everything else stops at the
// budget, and a budget the caller chose is a ceiling for all of them.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function slow(id: string, ms: number, overrides: Partial<Source> = {}): Source {
  return { id, stage: 'collect', timeoutMs: 1000, run: async () => (await sleep(ms), id), ...overrides }
}

describe('the grace period', () => {
  it('is 400ms past the 350ms default budget', () => {
    expect(DEFAULT_BUDGET_MS).toBe(350)
    expect(DEFAULT_GRACE_MS).toBe(400)
  })

  it('lets an identity-critical source finish past the default budget, and nothing else', async () => {
    const { outcomes } = await collect([
      slow('ordinary', 500),
      slow('critical', 500, { identityCritical: true }),
    ])

    expect(outcomes.ordinary?.status).toBe('timeout')
    expect(outcomes.critical).toMatchObject({ status: 'ok', value: 'critical' })
  })

  it('still ends a critical source at the end of the grace period', async () => {
    const started = Date.now()
    const { outcomes } = await collect([slow('critical', 2000, { identityCritical: true })])

    expect(outcomes.critical?.status).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(DEFAULT_BUDGET_MS + DEFAULT_GRACE_MS + 150)
  })

  it('is not given when the caller chose the budget', async () => {
    const { outcomes } = await collect([slow('critical', 300, { identityCritical: true })], { budgetMs: 150 })

    expect(outcomes.critical?.status).toBe('timeout')
  })

  it('can be set explicitly alongside a chosen budget', async () => {
    const { outcomes } = await collect([slow('critical', 250, { identityCritical: true })], {
      budgetMs: 100,
      graceMs: 300,
    })

    expect(outcomes.critical).toMatchObject({ status: 'ok' })
  })

  it('starts critical sources first when the stage is crowded', async () => {
    const order: string[] = []
    const track = (id: string, ms: number, critical = false): Source => ({
      id,
      stage: 'collect',
      identityCritical: critical,
      run: async () => {
        order.push(id)
        await sleep(ms)
        return id
      },
    })

    await collect([track('a', 10), track('b', 10), track('critical', 10, true)], { concurrency: 1 })

    expect(order[0]).toBe('critical')
    expect(order.slice(1)).toEqual(['a', 'b'])
  })

  it('costs a warm run nothing', async () => {
    const started = Date.now()
    const { outcomes } = await collect([slow('critical', 5, { identityCritical: true }), slow('ordinary', 5)])

    expect(outcomes.critical?.status).toBe('ok')
    expect(Date.now() - started).toBeLessThan(100)
  })
})
