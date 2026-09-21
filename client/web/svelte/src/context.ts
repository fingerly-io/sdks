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

import { createFingerly, type Fingerly, type FingerlyOptions } from './state.svelte.js'

/**
 * The context key.
 *
 * A symbol, so nothing else can collide with it, and exported so an advanced
 * caller can reach the state with `getContext()` directly.
 */
export const FINGERLY_KEY: unique symbol = Symbol('fingerly')

/**
 * Create the state and put it in context. Call it once, high up.
 *
 * ```svelte
 * <!-- +layout.svelte -->
 * <script lang="ts">
 *   import { setupFingerly } from '@fingerly/svelte'
 *   setupFingerly({ apiKey: 'fly_pk_production_…' })
 * </script>
 * ```
 *
 * Like every Svelte context call, it has to run during component
 * initialisation - not in an event handler, and not in an `$effect`.
 *
 * Nothing is collected here. When to identify stays the page's decision.
 */
export function setupFingerly(options: FingerlyOptions): Fingerly {
  const fingerly = createFingerly(options)
  setContext(FINGERLY_KEY, fingerly)
  return fingerly
}

/**
 * The state `setupFingerly()` put in context.
 *
 * The error is worth its length: a missing setup otherwise surfaces as
 * "cannot read properties of undefined" inside a function the caller did not
 * write, and the fix - one call in a layout - is not guessable from that.
 */
export function useFingerly(): Fingerly {
  if (!hasContext(FINGERLY_KEY)) {
    throw new Error(
      'No Fingerly context. Call setupFingerly() in a component above this one:\n\n' +
        "  import { setupFingerly } from '@fingerly/svelte'\n" +
        "  setupFingerly({ apiKey: 'fly_pk_production_…' })\n\n" +
        'It has to run during component initialisation - a <script> block, not an ' +
        'event handler or an $effect.',
    )
  }

  return getContext<Fingerly>(FINGERLY_KEY)
}
