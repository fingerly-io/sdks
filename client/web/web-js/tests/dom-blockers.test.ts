/**
 * The filter-list table, checked as data.
 *
 * The behaviour needs a browser with layout in it - happy-dom reports every
 * element as zero-sized, which the source reads as "something is hiding
 * everything" and answers by reporting nothing, so a test there would only
 * ever exercise the guard. It was verified in Chrome 151 and Firefox 154
 * instead: nothing blocked on a clean profile, exactly the two expected names
 * with two lists' selectors hidden by a stylesheet, and nothing at all when
 * every div on the page was hidden.
 *
 * What is worth pinning here is the table, because a name in it is a value
 * stored in every report that carries this source, and the server counts them.
 */

import { describe, expect, it } from 'vitest'

import { domBlockersSource } from '../src/sources/dom.js'

// The names as they ship. Changing one silently changes what every stored
// report means, so this is a list to update deliberately rather than a
// snapshot to regenerate.
const NAMES = [
  'easylist',
  'easylist_germany',
  'easylist_italy',
  'easylist_dutch',
  'easyprivacy',
  'fanboy_annoyances',
  'fanboy_social',
  'adguard_base',
  'adguard_annoyances',
  'listekr',
  'liste_fr',
  'ro_list',
]

/** Reach the table through the module's source text rather than exporting it. */
async function table(): Promise<[string, ...string[]][]> {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile('src/sources/dom.ts', 'utf8')
  const block = source.slice(source.indexOf('const FILTER_LISTS'), source.indexOf('\n]', source.indexOf('const FILTER_LISTS')))

  return [...block.matchAll(/\['([a-z_]+)',\s*'([^']+)',\s*'([^']+)'\]/g)].map(
    ([, name, first, second]) => [name, first, second] as [string, ...string[]],
  )
}

describe('the content-blocker source', () => {
  it('runs in the deferred tier, because it inserts elements and waits', () => {
    // The most intrusive thing any source here does has no business competing
    // with the fast tier for the budget.
    expect(domBlockersSource.tier).toBe('deferred')
    expect(domBlockersSource.id).toBe('dom_blockers')
  })

  it('ships the names the server counts, unchanged', async () => {
    expect((await table()).map(([name]) => name)).toEqual(NAMES)
  })

  it('gives every list two selectors, and never the same one twice', async () => {
    const lists = await table()
    const selectors = lists.flatMap(([, ...rest]) => rest)

    for (const [name, ...rest] of lists) {
      expect(rest.length, `${name} has ${rest.length} selectors`).toBe(2)
    }
    // A selector shared between two lists would attribute one blocker's work
    // to both of them.
    expect(new Set(selectors).size).toBe(selectors.length)
    // Classes and ids only: an attribute selector matches far more of a page's
    // own markup, which is where a false positive would come from.
    for (const selector of selectors) {
      expect(selector, selector).toMatch(/^[.#][A-Za-z][\w-]*$/)
    }
  })
})
