/** Regions with physically isolated Fingerly visitor-data planes. */
export type DataRegion = 'eu' | 'us'

const REGIONAL_ENDPOINTS: Readonly<Record<DataRegion, string>> = Object.freeze({
  eu: 'https://eu.api.fingerly.io',
  us: 'https://us.api.fingerly.io',
})

const FALLBACK_ENDPOINT = 'https://api.fingerly.io'

/**
 * Read the residency marker from a Fingerly credential.
 *
 * Authentication still decides whether a credential is genuine; this parser
 * only selects a network destination. Unrecognized input uses the explicitly
 * configured default rather than guessing a data region.
 */
export function regionFromKey(apiKey: string): DataRegion | undefined {
  const match = /^fly_(?:pk|sk|px)_(eu|us)_(?:production|staging|development)_/.exec(apiKey)
  return match?.[1] === 'us' ? 'us' : match?.[1] === 'eu' ? 'eu' : undefined
}

/** The direct Fingerly data-plane endpoint for a credential. */
export function defaultEndpointForKey(apiKey: string): string {
  const region = regionFromKey(apiKey)
  return region === undefined ? FALLBACK_ENDPOINT : REGIONAL_ENDPOINTS[region]
}
