'use client'

/**
 * Carrying the identification into a Server Action.
 */

import { useIdentify } from '@badele/react'
import type { ReactNode } from 'react'

import { REQUEST_ID_FIELD } from './field-name.js'

export interface BadeleRequestIdProps {
  /** Overrides the field name. Read it back with the same value. */
  name?: string
  /**
   * Identify on mount, so the field has something to carry by the time the
   * form is submitted.
   *
   * On by default, because a hidden field whose whole job is to carry a
   * `requestId` and which is empty at submit time is worse than no field: the
   * action succeeds and the event is never correlated. Turn it off in a form
   * that identifies at submit time instead.
   */
  immediate?: boolean
}

/**
 * A hidden input carrying this page's `requestId`.
 *
 * ```tsx
 * <form action={signUp}>
 *   <input name="email" />
 *   <BadeleRequestId />
 *   <button>Create account</button>
 * </form>
 * ```
 *
 * A Server Action runs where the browser is not, so the identification has to
 * travel with the submission. A form field is how, and it is the option that
 * keeps working without JavaScript having hydrated - the field is in the HTML
 * and empty rather than absent, which the server can tell apart.
 *
 * Read it back with `readRequestId(formData)` from `@badele/next/server`.
 */
export function BadeleRequestId({ name, immediate = true }: BadeleRequestIdProps = {}): ReactNode {
  const { requestId } = useIdentify({ immediate })

  return (
    <input
      type="hidden"
      name={name ?? REQUEST_ID_FIELD}
      // `readOnly` rather than `onChange`: it is a hidden field with no user
      // to change it, and React warns about a value with neither.
      readOnly
      value={requestId ?? ''}
    />
  )
}
