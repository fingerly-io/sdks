/**
 * `@fingerly/next/server` - the half that runs where there is no browser.
 *
 * A separate entry, and it has to be. Everything in the main entry is a
 * `'use client'` module, and a Server Action that imported from there would
 * get a client reference rather than a function - the import succeeds and the
 * call fails at runtime, which is the worst way to learn about a boundary.
 *
 * Nothing here touches React.
 */

import { REQUEST_ID_FIELD } from './field-name.js'
export { createProxy as createFingerlyProxy } from '@fingerly/node'
export type { ProxyOptions as FingerlyProxyOptions } from '@fingerly/node'

export { REQUEST_ID_FIELD }

/**
 * The longest `requestId` this will hand back.
 *
 * The field arrives from a page, which means it arrives from whoever is
 * driving the browser - it is form input like any other, and a server that
 * logs or joins on it unchecked is one `<input name="fingerly_request_id">` away
 * from storing whatever the visitor typed. A real one is a short opaque token,
 * so anything longer is not a truncation case, it is a different thing
 * arriving.
 */
const MAX_LENGTH = 128

/** Opaque tokens, and nothing that would need escaping to store or log. */
const SHAPE = /^[A-Za-z0-9_-]+$/

/**
 * Read the `requestId` a `<FingerlyRequestId />` field carried into an action.
 *
 * ```ts
 * 'use server'
 * import { readRequestId } from '@fingerly/next/server'
 *
 * export async function signUp(formData: FormData) {
 *   const requestId = readRequestId(formData)
 *   // correlate the signup with the identification, or proceed without one
 * }
 * ```
 *
 * Returns null rather than throwing when the field is missing, empty or
 * malformed, because all three mean the same thing to the caller: this
 * submission has no identification attached. A form submitted before the SDK
 * finished, or with JavaScript disabled, is a normal event and not an error -
 * what the server does about it is a policy the server owns.
 */
export function readRequestId(
  formData: Pick<FormData, 'get'>,
  options: { name?: string } = {},
): string | null {
  const value = formData.get(options.name ?? REQUEST_ID_FIELD)

  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) return null
  if (!SHAPE.test(trimmed)) return null

  return trimmed
}
