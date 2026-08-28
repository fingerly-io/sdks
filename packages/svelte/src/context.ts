/**
 * Putting the state where every component can reach it.
 *
 * Svelte's context rather than a module-level singleton, and the reason is the
 * server. A module-level state on a SvelteKit server is shared by every
 * request the process renders, which is the one way this package could leak
 * one visitor's report into another visitor's page. Context is per component
 * tree, and a component tree is per request.
 */

import { getContext, hasContext, setContext } from 'svelte'

import { createBadele, type Badele, type BadeleOptions } from './state.svelte.js'

/**
 * The context key.
 *
 * A symbol, so nothing else can collide with it, and exported so an advanced
 * caller can reach the state with `getContext()` directly.
 */
export const BADELE_KEY: unique symbol = Symbol('badele')

/**
 * Create the state and put it in context. Call it once, high up.
 *
 * ```svelte
 * <!-- +layout.svelte -->
 * <script lang="ts">
 *   import { setupBadele } from '@badele/svelte'
 *   setupBadele({ apiKey: 'pk_live_…' })
 * </script>
 * ```
 *
 * Like every Svelte context call, it has to run during component
 * initialisation - not in an event handler, and not in an `$effect`.
 *
 * Nothing is collected here. When to identify stays the page's decision.
 */
export function setupBadele(options: BadeleOptions): Badele {
  const badele = createBadele(options)
  setContext(BADELE_KEY, badele)
  return badele
}

/**
 * The state `setupBadele()` put in context.
 *
 * The error is worth its length: a missing setup otherwise surfaces as
 * "cannot read properties of undefined" inside a function the caller did not
 * write, and the fix - one call in a layout - is not guessable from that.
 */
export function useBadele(): Badele {
  if (!hasContext(BADELE_KEY)) {
    throw new Error(
      'No Badele context. Call setupBadele() in a component above this one:\n\n' +
        "  import { setupBadele } from '@badele/svelte'\n" +
        "  setupBadele({ apiKey: 'pk_live_…' })\n\n" +
        'It has to run during component initialisation - a <script> block, not an ' +
        'event handler or an $effect.',
    )
  }

  return getContext<Badele>(BADELE_KEY)
}
