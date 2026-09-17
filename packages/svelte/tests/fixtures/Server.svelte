<script lang="ts">
  import { setupFingerly, useIdentify } from '../../src/index.js'

  const fingerly = setupFingerly({ apiKey: 'fly_pk_us_development_test' })
  const identified = useIdentify({ immediate: true })

  // Awaiting is not possible during a component's initialisation, so the
  // rejection is parked on the global for the test to read rather than
  // awaited. What matters is which error it is.
  fingerly.identify().catch((error: unknown) => {
    ;(globalThis as Record<string, unknown>).__fingerlyServerError = error
  })
</script>

<output>ready:{identified.isReady} suspicious:{identified.isSuspicious}</output>
