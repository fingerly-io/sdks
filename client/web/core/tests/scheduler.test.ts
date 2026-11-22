import { describe, expect, it } from 'vitest'

import { collect, DEFAULT_BUDGET_MS } from '../src/scheduler.js'
import { BlockedSignal, UnsupportedSignal, type Source } from '../src/source.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function source(id: string, run: Source['run'], overrides: Partial<Source> = {}): Source {
  return { id, stage: 'collect', run, ...overrides }
}

describe('collect', () => {
  it('uses a 350ms default single-pass budget ceiling', () => {
    expect(DEFAULT_BUDGET_MS).toBe(350)
  })

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
      { budgetMs: 350, concurrency: 2 },
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

    expect(elapsed).toBeLessThan(600)
    expect(truncated).toBe(true)
    expect(Object.keys(outcomes)).toHaveLength(8)
    for (const outcome of Object.values(outcomes)) {
      expect(outcome.status).toBe('timeout')
    }
  })

  it('reports every source even when the budget ran out before they started', async () => {
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

    expect(Object.keys(outcomes).sort()).toEqual(['blocks', 'never-started'])
    expect(outcomes['never-started']).toMatchObject({
      status: 'timeout',
      reason: 'budget-exhausted',
      ms: 0,
    })
  })

  it('runs the prerequisite stage before the collect stage', async () => {
    const order: string[] = []
    const record = (id: string) => () => {
      order.push(id)
      return id
    }

    await collect(
      [
        source('collect-a', record('collect-a'), { stage: 'collect' }),
        source('prereq-a', record('prereq-a'), { stage: 'prerequisite' }),
        source('collect-b', record('collect-b')),
        source('prereq-b', record('prereq-b'), { stage: 'prerequisite' }),
      ],
      { concurrency: 1 },
    )

    expect(order).toEqual(['prereq-a', 'prereq-b', 'collect-a', 'collect-b'])
  })

  it('completes the whole prerequisite stage as a barrier before any collect source starts', async () => {
    let prereqFinished = 0
    let collectSawAllPrereq: boolean | undefined

    await collect(
      [
        source(
          'slow-prereq',
          async () => {
            await sleep(40)
            prereqFinished++
            return 'a'
          },
          { stage: 'prerequisite' },
        ),
        source(
          'quick-prereq',
          () => {
            prereqFinished++
            return 'b'
          },
          { stage: 'prerequisite' },
        ),
        source(
          'canvas',
          () => {
            collectSawAllPrereq = prereqFinished === 2
            return 'c'
          },
          { stage: 'collect' },
        ),
      ],
      { budgetMs: 1000, concurrency: 6 },
    )

    expect(collectSawAllPrereq).toBe(true)
  })

  it('passes completed Stage 1 outcomes and shared context into Stage 2', async () => {
    let seenOutcome: unknown
    let seenShared: unknown

    await collect(
      [
        source(
          'timing',
          (ctx) => {
            ctx.shared?.set('rfpBlocked', true)
            return { now_resolution: 100, rfp_canvas_blocked: true }
          },
          { stage: 'prerequisite' },
        ),
        source(
          'shields',
          (ctx) => {
            seenOutcome = ctx.completed('timing')
            seenShared = ctx.shared?.get('rfpBlocked')
            return 'ok'
          },
          { stage: 'collect' },
        ),
      ],
      { budgetMs: 1000 },
    )

    expect(seenOutcome).toMatchObject({
      status: 'ok',
      value: { now_resolution: 100, rfp_canvas_blocked: true },
    })
    expect(seenShared).toBe(true)
  })

  it('hides same-stage sibling outcomes so concurrent sources cannot race', async () => {
    let sameStage: unknown = 'unset'

    await collect(
      [
        source('first', () => 1),
        source('asks', (ctx) => {
          sameStage = ctx.completed('first')
          return 2
        }),
      ],
      { concurrency: 1 },
    )

    expect(sameStage).toBeUndefined()
  })

  it('gates extended-incognito sources behind incognitoDetection === "extended"', async () => {
    const sources: Source[] = [
      source('always', () => 'a'),
      source('durability', () => 'd', { optIn: 'extended-incognito' }),
    ]

    const standard = await collect(sources)
    expect(Object.keys(standard.outcomes)).toEqual(['always'])

    const explicitStandard = await collect(sources, { incognitoDetection: 'standard' })
    expect(Object.keys(explicitStandard.outcomes)).toEqual(['always'])

    const extended = await collect(sources, { incognitoDetection: 'extended' })
    expect(Object.keys(extended.outcomes).sort()).toEqual(['always', 'durability'])
  })

  it('gates agent-interaction sources behind agentDetection === "interaction"', async () => {
    const sources: Source[] = [
      source('always', () => 'a'),
      source('interaction', () => 'i', { optIn: 'agent-interaction' }),
    ]

    const off = await collect(sources)
    expect(Object.keys(off.outcomes)).toEqual(['always'])

    const incognitoOnly = await collect(sources, { incognitoDetection: 'extended' })
    expect(Object.keys(incognitoOnly.outcomes)).toEqual(['always'])

    const on = await collect(sources, { agentDetection: 'interaction' })
    expect(Object.keys(on.outcomes).sort()).toEqual(['always', 'interaction'])
  })

  it('leaves out a source that is not active, or whose check throws, without running it', async () => {
    let runs = 0
    const counted = () => {
      runs += 1
      return 'x'
    }
    const { outcomes } = await collect([
      source('active', counted, { active: () => true }),
      source('idle', counted, { active: () => false }),
      source('broken', counted, {
        active: () => {
          throw new Error('boom')
        },
      }),
    ])

    expect(Object.keys(outcomes)).toEqual(['active'])
    expect(runs).toBe(1)
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

    expect(Number.isInteger(outcomes.quick?.ms)).toBe(true)
  })
})
