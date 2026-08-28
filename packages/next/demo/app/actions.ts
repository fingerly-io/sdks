'use server'

import { readRequestId } from '@badele/next/server'

/**
 * A Server Action, which is the half of this package that unit tests can only
 * describe: it runs where the browser is not, and the identification has to
 * have travelled with the submission for it to see one.
 *
 * Returns what it read rather than storing anything, so the page can show
 * whether the field arrived - including the case where it arrived empty
 * because the form was submitted before the SDK finished.
 */
export async function submit(_previous: unknown, formData: FormData) {
  const requestId = readRequestId(formData)
  const email = String(formData.get('email') ?? '')

  return {
    at: new Date().toISOString(),
    email,
    requestId,
    // The raw field, so the difference between "absent", "present and empty"
    // and "present" is visible rather than collapsed into null.
    raw: String(formData.get('badele_request_id') ?? '(no field)'),
  }
}
