<script lang="ts">
  import { setupBadele, useIdentify } from '../../src/index.js'

  const badele = setupBadele({ apiKey: 'pk_test' })
  const identified = useIdentify({ immediate: true })

  // Awaiting is not possible during a component's initialisation, so the
  // rejection is parked on the global for the test to read rather than
  // awaited. What matters is which error it is.
  badele.identify().catch((error: unknown) => {
    ;(globalThis as Record<string, unknown>).__badeleServerError = error
  })
</script>

<output>ready:{identified.isReady} suspicious:{identified.isSuspicious}</output>
