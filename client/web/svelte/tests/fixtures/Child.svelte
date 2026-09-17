<script lang="ts">
  import { useIdentify } from '../../src/index.js'

  // Every child asks for its own identification, on mount, which is the case
  // the sharing rule exists for: this must be one submission, not three.
  const fingerly = useIdentify({ immediate: true })
</script>

<span class="child">{fingerly.requestId ?? '-'}</span>
