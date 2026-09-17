import { describe, expect, it } from 'vitest'

import { defaultEndpointForKey, regionFromKey } from '../src/routing.js'

describe('region-aware endpoint routing', () => {
  it.each([
    ['fly_pk_us_production_example', 'us', 'https://us.api.fingerly.io'],
    ['fly_sk_eu_staging_example', 'eu', 'https://eu.api.fingerly.io'],
    ['fly_px_us_development_example', 'us', 'https://us.api.fingerly.io'],
  ] as const)('routes %s to its isolated plane', (key, region, endpoint) => {
    expect(regionFromKey(key)).toBe(region)
    expect(defaultEndpointForKey(key)).toBe(endpoint)
  })

  it('uses the default endpoint for unrecognized credentials', () => {
    expect(regionFromKey('not-a-fingerly-key')).toBeUndefined()
    expect(defaultEndpointForKey('not-a-fingerly-key')).toBe('https://api.fingerly.io')
  })
})
