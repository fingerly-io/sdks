/**
 * Consent, as the client sees it.
 *
 * A customer whose legal basis for identifying a visitor is consent has to be
 * able to load the SDK early - in the bundle, before the banner has been
 * answered - and have it do nothing observable until their consent tool says
 * otherwise. The state and its vocabulary live in `@fingerly/types`, beside
 * the other shapes the mobile SDKs share; the error lives here, because it is
 * a class and that package holds no code.
 */

import type { ConsentState } from './types.js'

const STATES: readonly ConsentState[] = ['granted', 'pending', 'denied']

/**
 * Refuse anything that is not one of the three states.
 *
 * Loud rather than lenient. Consent tools hand over booleans, `'accepted'`,
 * `'all'` - and a client that quietly read any of those as `granted` would be
 * identifying visitors who said no, while one that read them as `pending`
 * would stop identifying anybody without saying why.
 */
export function assertConsentState(state: unknown): asserts state is ConsentState {
  if (!STATES.includes(state as ConsentState)) {
    throw new TypeError(
      `Fingerly consent must be 'granted', 'pending' or 'denied' (received ${JSON.stringify(state)})`,
    )
  }
}

/**
 * The call was refused because consent is not `granted`.
 *
 * Thrown by `identify()` and `collect()` before any source runs, and again by
 * a call already in flight when consent is withdrawn before it submits. `code`
 * is the same string every Fingerly SDK and bridge uses for this failure, so a
 * handler shared across platforms can branch on it without an `instanceof`.
 */
export class ConsentError extends Error {
  override readonly name = 'ConsentError'
  readonly code = 'consent_required'

  constructor(readonly state: ConsentState) {
    super(`Fingerly needs consent before it can identify this visitor (consent is ${state})`)
  }
}
