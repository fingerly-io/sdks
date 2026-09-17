/**
 * What the visitor's content blocker hides.
 *
 * The measurement is direct: put elements into the page that public filter
 * lists match, let the blocker do its work, and see which of them stopped
 * being rendered. Nothing is asked of the browser and nothing is asked of the
 * visitor - the elements are one pixel, off-screen, and gone before this
 * returns.
 *
 * The lists are the signal, not the total. Whether *a* blocker is present is
 * one bit and a common one; *which* lists it runs is a trait - the regional
 * ones are chosen by people who read those languages, and the combination is
 * stable across sessions in a way an ad-block yes/no is not.
 */

import { SOURCE, UnsupportedSignal, type DomBlockersSignal, type Source } from '@fingerly/core'

import { compact, requireWindow } from '../util.js'

/**
 * Two selectors per list, taken from the lists themselves.
 *
 * Two rather than one because a list can retire a rule, and rather than ten
 * because each one is an element the browser has to lay out. Classes and ids
 * only: attribute selectors would match more but are also what a page's own
 * stylesheet is most likely to hit by accident.
 *
 * Appending a list is safe. Renaming one is not - the name is what a stored
 * report carries, and the server counts on it.
 */
const FILTER_LISTS: readonly (readonly [name: string, ...selectors: string[]])[] = [
  ['easylist', '.ad_300x250', '.textads'],
  ['easylist_germany', '.werbung1', '.werbeblock'],
  ['easylist_italy', '.pubbl', '.banner_pubblicita'],
  ['easylist_dutch', '.advertentie-container', '.reclame'],
  ['easyprivacy', '.trackingpixel', '#tracking-pixel'],
  ['fanboy_annoyances', '#newsletter-signup-modal', '.cookie-consent-banner'],
  ['fanboy_social', '.social-share-buttons', '.facebook-like-box'],
  ['adguard_base', '#adsense_widget', '.adsbygoogle-container'],
  ['adguard_annoyances', '.push-notification-prompt', '#app-install-banner'],
  ['listekr', '#ad_wrapper_top', '.ad_zone'],
  ['liste_fr', '.pub_300x250', '#pubfooter'],
  ['ro_list', '.reclama-mare', '#reclama'],
]

/**
 * How long the blocker is given to act.
 *
 * Cosmetic filtering runs when the elements enter the document, not when the
 * script that inserted them returns, so there has to be a wait. A frame plus a
 * short timer: the frame is the usual case and the timer is the browser that
 * does not schedule one because the tab is hidden.
 */
const SETTLE_MS = 60

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (!settled) {
        settled = true
        resolve()
      }
    }
    setTimeout(done, SETTLE_MS)
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(done, 0))
  })
}

/** Whether an element was taken out of the page's layout. */
function hidden(element: HTMLElement): boolean {
  if (element.offsetParent === null) return true
  if (element.offsetHeight === 0 || element.offsetWidth === 0) return true

  const style = getComputedStyle(element)
  return style.display === 'none' || style.visibility === 'hidden'
}

/**
 * Build one probe element.
 *
 * Position and size are set inline; `display` deliberately is not. A blocker
 * hides elements from a user-origin stylesheet, which outranks anything set
 * here, so declaring `display: block` would not survive it - and would be a
 * lie about what this measures.
 */
function probe(document: Document, selector: string): HTMLElement {
  const element = document.createElement('div')
  if (selector.startsWith('#')) element.id = selector.slice(1)
  else element.className = selector.slice(1)

  element.style.position = 'absolute'
  element.style.top = '-9999px'
  element.style.left = '-9999px'
  element.style.width = '1px'
  element.style.height = '1px'
  return element
}

export const domBlockersSource: Source<DomBlockersSignal> = {
  id: SOURCE.domBlockers,
  // Deferred: it inserts elements, waits for a paint and reads back layout,
  // which is the most intrusive thing any source here does and has no business
  // competing with the fast tier for the budget.
  tier: 'deferred',
  timeoutMs: 300,
  async run() {
    requireWindow()
    if (typeof document === 'undefined' || !document.body) {
      throw new UnsupportedSignal('no-document-body')
    }

    const container = document.createElement('div')
    container.style.position = 'absolute'
    container.style.top = '-9999px'
    container.style.left = '-9999px'
    container.style.width = '1px'
    container.style.height = '1px'

    // A control with a name no filter list has any interest in. If this one is
    // hidden too, something other than a blocker is hiding the container - a
    // page stylesheet, a print rule, a parent that is display:none - and every
    // "blocked" reading in this run would be that instead. Reporting nothing
    // is the honest answer to that, and the alternative is telling a customer
    // their visitor runs twelve filter lists.
    const control = probe(document, '.fingerly-control-element')
    container.appendChild(control)

    const elements = FILTER_LISTS.map(([name, ...selectors]) => ({
      name,
      nodes: selectors.map((selector) => {
        const element = probe(document, selector)
        container.appendChild(element)
        return element
      }),
    }))

    document.body.appendChild(container)

    try {
      await nextPaint()

      if (hidden(control)) return {}

      const blocked = elements
        .filter(({ nodes }) => nodes.some(hidden))
        .map(({ name }) => name)

      return compact<DomBlockersSignal>({ blocked, probed: FILTER_LISTS.length })
    } finally {
      // In a `finally` because the alternative is a page left with twenty-five
      // divs named after advertising slots in it.
      container.remove()
    }
  },
}
