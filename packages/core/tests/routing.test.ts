import { describe, expect, it } from 'vitest'

import { defaultEndpointForKey, regionFromKey } from '../src/routing.js'

describe('region-aware endpoint routing', () => {
  it.each([
    ['bd_pk_us_production_example', 'us', 'https://us.api.badele.io'],
    ['bd_sk_eu_staging_example', 'eu', 'https://eu.api.badele.io'],
    ['bd_px_us_development_example', 'us', 'https://us.api.badele.io'],
  ] as const)('routes %s to its isolated plane', (key, region, endpoint) => {
    expect(regionFromKey(key)).toBe(region)
    expect(defaultEndpointForKey(key)).toBe(endpoint)
  })

  it('keeps legacy and malformed credentials on the compatibility endpoint', () => {
    expect(regionFromKey('pk_live_legacy')).toBeUndefined()
    expect(defaultEndpointForKey('pk_live_legacy')).toBe('https://api.badele.io')
  })
})
