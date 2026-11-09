<script lang="ts">
  import { setupFingerly, useIdentify } from '../src/index.js'
  import Triggers from './Triggers.svelte'

  // submit: false - the playground collects and sends nothing, so no server
  // answers: the raw report fills in and the score, level and triggers stay
  // empty.
  setupFingerly({ apiKey: 'pk_demo', submit: false })

  const fingerly = useIdentify({ immediate: true, tag: 'svelte-playground' })
</script>

<h1>Fingerly — Svelte binding</h1>

<div class="bar">
  <button onclick={() => void fingerly.refresh().catch(() => undefined)}>refresh()</button>
  <span class="status">{fingerly.isLoading ? 'collecting…' : fingerly.isReady ? 'ready' : 'idle'}</span>
</div>

<div class="card">
  <h3>state</h3>
  <div class="row"><span class="k">suspectScore</span><span class="v">{fingerly.suspectScore ?? '— (no server answer)'}</span></div>
  <div class="row"><span class="k">suspectLevel</span><span class="v" class:hit={fingerly.suspectLevel === 'high'}>{fingerly.suspectLevel ?? '— (no server answer)'}</span></div>
  <div class="row"><span class="k">requestId</span><span class="v">{fingerly.requestId ?? '— (submit: false)'}</span></div>
  <div class="row"><span class="k">sources</span><span class="v">{fingerly.report ? Object.keys(fingerly.report.sources).length : '—'}</span></div>
  <div class="row"><span class="k">elapsed_ms</span><span class="v">{fingerly.report?.elapsed_ms ?? '—'}</span></div>
  <div class="row"><span class="k">engine</span><span class="v">{fingerly.report?.integrity.engine.observed ?? '—'}</span></div>
  {#if fingerly.error}
    <div class="row"><span class="k">error</span><span class="v hit">{fingerly.error.message}</span></div>
  {/if}
</div>

<div class="grid">
  <Triggers />
</div>
