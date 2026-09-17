<script lang="ts">
  import { useFingerly } from '../../src/index.js'

  // No setupFingerly() anywhere above this, which is the mistake the error
  // message is for.
  const fingerly = useFingerly()
</script>

<span>{fingerly.isReady}</span>
