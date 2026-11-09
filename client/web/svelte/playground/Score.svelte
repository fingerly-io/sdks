<script lang="ts">
  import { useIdentify } from '../src/index.js'

  // A second reader of the shared identification, which is still one
  // submission. That is the rule this playground is here to show.
  const fingerly = useIdentify({ tag: 'svelte-playground' })
</script>

<div class="card">
  <h3>result</h3>
  <div class="row"><span class="k">score</span><span class="v">{fingerly.suspectScore ?? 'hidden'}</span></div>
  <div class="row"><span class="k">level</span><span class="v" class:hit={fingerly.suspectLevel === 'high'}>{fingerly.suspectLevel ?? 'hidden'}</span></div>
  <div class="row"><span class="k">signals</span><span class="v">read on your backend</span></div>
</div>
