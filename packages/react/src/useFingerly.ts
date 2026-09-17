'use client'

/**
 * Reaching the provider from a hook.
 */

import { use } from 'react'

import { FingerlyContext } from './context.js'
import type { FingerlyStore } from './store.js'

/**
 * The store the provider made available.
 *
 * Read with React 19's `use()` rather than `useContext()`. The two are the
 * same read here; `use()` is the one that keeps working if a caller ever needs
 * it inside a branch, which is where `useContext` cannot go.
 *
 * The error is worth its length. A missing provider otherwise surfaces as
 * "cannot read properties of null" three frames inside a hook the caller did
 * not write, and the fix - one component near the root - is not guessable from
 * that.
 */
export function useFingerly(): FingerlyStore {
  const store = use(FingerlyContext)

  if (!store) {
    throw new Error(
      'No <FingerlyProvider> found above this component. Add one near the root:\n\n' +
        "  import { FingerlyProvider } from '@fingerly/react'\n" +
        "  <FingerlyProvider apiKey='fly_pk_us_production_…'><App /></FingerlyProvider>",
    )
  }

  return store
}
