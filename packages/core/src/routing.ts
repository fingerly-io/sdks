/** Regions with physically isolated Badele visitor-data planes. */
export type DataRegion = 'eu' | 'us'

const REGIONAL_ENDPOINTS: Readonly<Record<DataRegion, string>> = Object.freeze({
  eu: 'https://eu.api.badele.io',
  us: 'https://us.api.badele.io',
})

const LEGACY_ENDPOINT = 'https://api.badele.io'

/**
 * Read the residency marker from a Badele credential.
 *
 * Regionless credentials predate residency-aware issuance. Authentication
 * still decides whether the credential is genuine; this parser only selects a
 * network destination.
 */
export function regionFromKey(apiKey: string): DataRegion | undefined {
  const match = /^bd_(?:pk|sk|px)_(eu|us)_(?:production|staging|development)_/.exec(apiKey)
  return match?.[1] === 'us' ? 'us' : match?.[1] === 'eu' ? 'eu' : undefined
}

/** The direct Badele data-plane endpoint for a credential. */
export function defaultEndpointForKey(apiKey: string): string {
  const region = regionFromKey(apiKey)
  return region === undefined ? LEGACY_ENDPOINT : REGIONAL_ENDPOINTS[region]
}
