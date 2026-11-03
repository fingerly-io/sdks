import { describe, expect, it } from 'vitest'

import { collect } from '../src/scheduler.js'
import { BlockedSignal, UnsupportedSignal, type Source } from '../src/source.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function source(id: string, run: Source['run'], overrides: Partial<Source> = {}): Source {
  return { id, tier: 'fast', run, ...overrides }
}

describe('collect', () => {
  it('records a value for a source that succeeds', async () => {
    const { outcomes } = await collect([source('ok', () => 42)])

    expect(outcomes.ok).toMatchObject({ status: 'ok', value: 42 })
    expect(outcomes.ok?.ms).toBeGreaterThanOrEqual(0)
  })

  it('classifies each failure by the error the source threw', async () => {
    const { outcomes } = await collect([
      source('missing', () => {
        throw new UnsupportedSignal('no-api')
      }),
      source('refused', () => {
        throw new BlockedSignal('SecurityError')
      }),
      source('broken', () => {
        throw new TypeError('something else')
      }),
    ])

    // Three different facts, never collapsed into one `error` token.
    expect(outcomes.missing).toMatchObject({ status: 'unsupported', reason: 'no-api' })
    expect(outcomes.refused).toMatchObject({ status: 'blocked', reason: 'SecurityError' })
    expect(outcomes.broken).toMatchObject({ status: 'error', reason: 'TypeError' })
  })

  it('treats a synchronous throw the same as a rejected promise', async () => {
    const { outcomes } = await collect([
      source('sync', () => {
        throw new UnsupportedSignal('sync')
      }),
      source('async', async () => {
        throw new UnsupportedSignal('async')
      }),
    ])

    expect(outcomes.sync?.status).toBe('unsupported')
    expect(outcomes.async?.status).toBe('unsupported')
  })

  it('times out a source that never settles, without taking the run down', async () => {
    const { outcomes } = await collect(
      [
        source('hangs', () => new Promise(() => {}), { timeoutMs: 30 }),
        source('fine', () => 'value'),
      ],
      { budgetMs: 500, concurrency: 2 },
    )

    expect(outcomes.hangs).toMatchObject({ status: 'timeout', reason: 'source-timeout' })
    expect(outcomes.fine).toMatchObject({ status: 'ok', value: 'value' })
  })

  it('resolves within the budget even when every source hangs', async () => {
    const hangers = Array.from({ length: 8 }, (_, index) =>
      source(`hang${index}`, () => new Promise(() => {})),
    )

    const started = Date.now()
    const { outcomes, truncated } = await collect(hangers, {
      budgetMs: 120,
      defaultSourceTimeoutMs: 1000,
      concurrency: 4,
    })
    const elapsed = Date.now() - started

    // The whole point of the file: no upper bound on any individual source,
    // but a hard one on the run. Generous slack so this is not flaky on a
    // loaded CI box - what is being asserted is "bounded", not a precise time.
    expect(elapsed).toBeLessThan(600)
    expect(truncated).toBe(true)
    expect(Object.keys(outcomes)).toHaveLength(8)
    for (const outcome of Object.values(outcomes)) {
      expect(outcome.status).toBe('timeout')
    }
  })

  it('reports every source even when the budget ran out before they started', async () => {
    // The first source blocks the thread synchronously for well past the
    // budget. That is what makes this deterministic: a source that *times out*
    // finishes exactly at the deadline, because its slice is capped by the
    // remaining budget, so whether the next source sees any time left comes
    // down to sub-millisecond scheduling. Overrunning by 40ms leaves no doubt -
    // and it is the honest case anyway, since `setTimeout` cannot interrupt
    // synchronous work.
    const blockFor = (ms: number) => {
      const until = Date.now() + ms
      while (Date.now() < until) {
        /* deliberately blocking */
      }
    }

    const { outcomes } = await collect(
      [
        source(
          'blocks',
          () => {
            blockFor(80)
            return 'ran-anyway'
          },
          { timeoutMs: 200 },
        ),
        source('never-started', () => 'unreachable'),
      ],
      { budgetMs: 40, concurrency: 1 },
    )

    // A report whose *keys* varied with load would be a fingerprint of the
    // load rather than of the device, so the set is constant regardless.
    expect(Object.keys(outcomes).sort()).toEqual(['blocks', 'never-started'])
    expect(outcomes['never-started']).toMatchObject({
      status: 'timeout',
      reason: 'budget-exhausted',
      ms: 0,
    })
  })

  it('runs the fast tier before the deferred one', async () => {
    const order: string[] = []
    const record = (id: string) => () => {
      order.push(id)
      return id
    }

    await collect(
      [
        source('deferred-a', record('deferred-a'), { tier: 'deferred' }),
        source('fast-a', record('fast-a')),
        source('deferred-b', record('deferred-b'), { tier: 'deferred' }),
        source('fast-b', record('fast-b')),
      ],
      { concurrency: 1 },
    )

    expect(order).toEqual(['fast-a', 'fast-b', 'deferred-a', 'deferred-b'])
  })

  it('completes the whole fast tier before any deferred source starts', async () => {
    // A barrier, not just an ordering. A deferred source that looks up a fast
    // source's outcome must not be able to lose that race - losing it, in the
    // canvas case, means prompting the user.
    let fastFinished = 0
    let deferredSawAllFast: boolean | undefined

    await collect(
      [
        source('slow-fast', async () => {
          await sleep(40)
          fastFinished++
          return 'a'
        }),
        source('quick-fast', () => {
          fastFinished++
          return 'b'
        }),
        source(
          'deferred',
          () => {
            deferredSawAllFast = fastFinished === 2
            return 'c'
          },
          { tier: 'deferred' },
        ),
      ],
      { budgetMs: 1000, concurrency: 6 },
    )

    expect(deferredSawAllFast).toBe(true)
  })

  it('lets a deferred source read a completed fast source', async () => {
    let seen: unknown

    await collect(
      [
        source('clock', () => ({ now_resolution: 100 })),
        source(
          'reader',
          (ctx) => {
            seen = ctx.completed('clock')
            return 'ok'
          },
          { tier: 'deferred' },
        ),
      ],
      { budgetMs: 1000 },
    )

    expect(seen).toMatchObject({ status: 'ok', value: { now_resolution: 100 } })
  })

  it('reports undefined for a source that has not run yet', async () => {
    let sameTier: unknown = 'unset'

    await collect([
      source('asks', (ctx) => {
        sameTier = ctx.completed('sibling')
        return 1
      }),
      source('sibling', () => 2),
    ])

    // Siblings run together, so a source must not depend on one. The contract
    // says undefined rather than a stale or racy value.
    expect(sameTier).toBeUndefined()
  })

  it('runs only the requested tiers', async () => {
    const { outcomes } = await collect(
      [
        source('fast', () => 'f'),
        source('deferred', () => 'd', { tier: 'deferred' }),
      ],
      { tiers: ['fast'] },
    )

    expect(Object.keys(outcomes)).toEqual(['fast'])
  })

  it('honours an external abort', async () => {
    const controller = new AbortController()
    controller.abort()

    const { outcomes, truncated } = await collect([source('any', () => 'value')], {
      signal: controller.signal,
    })

    expect(truncated).toBe(true)
    expect(outcomes.any?.status).toBe('timeout')
  })

  it('hands each source a signal that aborts when its slice expires', async () => {
    let aborted = false

    await collect(
      [
        source(
          'watches',
          (ctx) =>
            new Promise((_, reject) => {
              ctx.signal.addEventListener('abort', () => {
                aborted = true
                reject(ctx.signal.reason)
              })
            }),
          { timeoutMs: 25 },
        ),
      ],
      { budgetMs: 300 },
    )

    // A source that can cancel real work - a fetch, a frame callback - needs
    // this, or giving up would leave the work running behind a settled promise.
    expect(aborted).toBe(true)
  })

  it('caps how many sources run at once', async () => {
    let running = 0
    let peak = 0

    const sources = Array.from({ length: 10 }, (_, index) =>
      source(`s${index}`, async () => {
        running++
        peak = Math.max(peak, running)
        await sleep(10)
        running--
        return index
      }),
    )

    await collect(sources, { budgetMs: 2000, concurrency: 3 })

    expect(peak).toBeLessThanOrEqual(3)
  })

  it('rounds durations to whole milliseconds', async () => {
    const { outcomes } = await collect([source('quick', () => 1)])

    // Sub-millisecond precision would hand a reader a timer oracle and would
    // make every report differ in the noise.
    expect(Number.isInteger(outcomes.quick?.ms)).toBe(true)
  })
})
