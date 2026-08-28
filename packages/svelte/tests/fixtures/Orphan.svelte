<script lang="ts">
  import { useBadele } from '../../src/index.js'

  // No setupBadele() anywhere above this, which is the mistake the error
  // message is for.
  const badele = useBadele()
</script>

<span>{badele.isReady}</span>
