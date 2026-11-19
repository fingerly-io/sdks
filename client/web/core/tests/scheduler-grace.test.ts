import { describe, expect, it } from 'vitest'

import { collect, DEFAULT_BUDGET_MS, DEFAULT_GRACE_MS } from '../src/scheduler.js'
import type { Source } from '../src/source.js'

// A cold browser answers its identity-critical sources late. Under the default
// budget they may run into a grace period, where only its end stops them;
// everything else stops at the budget or its own timeout, and a budget the
// caller chose is a ceiling for all of them.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function slow(id: string, ms: number, overrides: Partial<Source> = {}): Source {
  return { id, stage: 'collect', timeoutMs: 1000, run: async () => (await sleep(ms), id), ...overrides }
}

describe('the grace period', () => {
  it('ends 2.5s after the start of a run under the 350ms default budget', () => {
    expect(DEFAULT_BUDGET_MS).toBe(350)
    expect(DEFAULT_BUDGET_MS + DEFAULT_GRACE_MS).toBe(2500)
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
    const { outcomes } = await collect([slow('critical', 4000, { identityCritical: true, timeoutMs: 5000 })])

    expect(outcomes.critical).toMatchObject({ status: 'timeout', reason: 'source-timeout' })
    expect(Date.now() - started).toBeLessThan(DEFAULT_BUDGET_MS + DEFAULT_GRACE_MS + 150)
  })

  it('does not stop a critical source at its own timeout while the grace period lasts', async () => {
    // A cold browser's voice list or audio render: slower than the source
    // usually is, and the answer that decides whether it is recognised.
    const { outcomes } = await collect([
      slow('critical', 900, { identityCritical: true, timeoutMs: 250 }),
      slow('ordinary', 200, { timeoutMs: 50 }),
    ])

    expect(outcomes.critical).toMatchObject({ status: 'ok', value: 'critical' })
    expect(outcomes.ordinary).toMatchObject({ status: 'timeout', reason: 'source-timeout' })
  })

  it('tells a critical source the time it has left until the grace period ends', async () => {
    let left = 0
    await collect([
      {
        id: 'critical',
        stage: 'collect',
        identityCritical: true,
        timeoutMs: 100,
        run: (ctx) => {
          left = ctx.budgetRemainingMs()
          return 'ok'
        },
      },
    ])

    expect(left).toBeGreaterThan(DEFAULT_BUDGET_MS + DEFAULT_GRACE_MS - 100)
  })

  it('keeps a critical source to its own timeout under a budget the caller chose', async () => {
    const { outcomes } = await collect([slow('critical', 300, { identityCritical: true, timeoutMs: 50 })], {
      budgetMs: 1000,
    })

    expect(outcomes.critical).toMatchObject({ status: 'timeout', reason: 'source-timeout' })
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
