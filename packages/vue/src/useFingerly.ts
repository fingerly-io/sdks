/**
 * Reaching the plugin from a composable.
 */

import { hasInjectionContext, inject } from 'vue'

import { fingerlyKey, type FingerlyContext } from './plugin.js'

/**
 * The Fingerly context the plugin provided.
 *
 * The two ways this fails are genuinely different mistakes, and the error says
 * which. `hasInjectionContext()` distinguishes them: calling a composable
 * outside `setup()` is a Vue mistake, and a missing plugin is a wiring mistake.
 * Both otherwise surface as the same baffling "cannot read properties of
 * undefined" three frames later.
 */
export function useFingerly(): FingerlyContext {
  if (!hasInjectionContext()) {
    throw new Error(
      'useFingerly() must be called from setup() or another composable. ' +
        'Calling it inside an event handler or a lifecycle callback is too late - ' +
        'capture it in setup() and use the returned value.',
    )
  }

  const context = inject(fingerlyKey, null)

  if (!context) {
    throw new Error(
      'No Fingerly plugin found. Install it before mounting:\n\n' +
        "  import { createFingerly } from '@fingerly/vue'\n" +
        "  app.use(createFingerly({ apiKey: 'fly_pk_us_production_…' }))",
    )
  }

  return context
}
