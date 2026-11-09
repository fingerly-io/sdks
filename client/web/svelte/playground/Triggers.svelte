<script lang="ts">
  import { useIdentify } from '../src/index.js'

  // A second reader of the shared identification, which is still one
  // submission. That is the rule this playground is here to show.
  const fingerly = useIdentify({ tag: 'svelte-playground' })
</script>

<div class="card">
  <h3>triggers</h3>
  <div class="row"><span class="k">level</span><span class="v" class:hit={fingerly.suspectLevel === 'high'}>{fingerly.suspectLevel ?? '—'}</span></div>
  {#if fingerly.triggers.length}
    <ul class="reasons">
      {#each fingerly.triggers as trigger (trigger.signal)}<li>{trigger.signal} ({trigger.group})</li>{/each}
    </ul>
  {:else}
    <div class="row"><span class="k">fired</span><span class="v">—</span></div>
  {/if}
</div>
