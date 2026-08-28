/**
 * The name of the form field that carries a `requestId` to the server.
 *
 * Its own module, imported by both entries, because it is the one thing the
 * client and the server have to agree on and neither can import the other:
 * the client entry is a `'use client'` module, which a Server Action cannot
 * call into, and `@badele/next/server` is the half that runs where there is no
 * React at all.
 *
 * A constant rather than a convention written twice in a README, because the
 * failure when the two drift is a form that submits successfully and a server
 * that quietly never sees an identification.
 */
export const REQUEST_ID_FIELD = 'badele_request_id'
