/**
 * Reaching the plugin from a composable.
 */

import { hasInjectionContext, inject } from 'vue'

import { badeleKey, type BadeleContext } from './plugin.js'

/**
 * The Badele context the plugin provided.
 *
 * The two ways this fails are genuinely different mistakes, and the error says
 * which. `hasInjectionContext()` distinguishes them: calling a composable
 * outside `setup()` is a Vue mistake, and a missing plugin is a wiring mistake.
 * Both otherwise surface as the same baffling "cannot read properties of
 * undefined" three frames later.
 */
export function useBadele(): BadeleContext {
  if (!hasInjectionContext()) {
    throw new Error(
      'useBadele() must be called from setup() or another composable. ' +
        'Calling it inside an event handler or a lifecycle callback is too late - ' +
        'capture it in setup() and use the returned value.',
    )
  }

  const context = inject(badeleKey, null)

  if (!context) {
    throw new Error(
      'No Badele plugin found. Install it before mounting:\n\n' +
        "  import { createBadele } from '@badele/vue'\n" +
        "  app.use(createBadele({ apiKey: 'pk_live_…' }))",
    )
  }

  return context
}
