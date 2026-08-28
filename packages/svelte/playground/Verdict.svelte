<script lang="ts">
  import { useVerdict, type VerdictName } from '../src/index.js'

  const { name }: { name: VerdictName } = $props()

  // Each card reads the shared identification. Three of them is still one
  // submission, which is the rule this playground is here to show.
  const verdict = useVerdict(() => name)
</script>

<div class="card">
  <h3>{name}</h3>
  <div class="row"><span class="k">matched</span><span class="v" class:hit={verdict.matched}>{verdict.matched}</span></div>
  <div class="row"><span class="k">confidence</span><span class="v">{verdict.confidence ?? '—'}</span></div>
  {#if verdict.reasons.length}
    <ul class="reasons">
      {#each verdict.reasons as reason (reason)}<li>{reason}</li>{/each}
    </ul>
  {/if}
</div>
