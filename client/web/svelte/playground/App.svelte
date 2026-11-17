<script lang="ts">
  import { setupFingerly, useIdentify } from '../src/index.js'
  import Score from './Score.svelte'

  setupFingerly({ apiKey: 'pk_demo', consent: 'granted' })

  const fingerly = useIdentify({ immediate: true, tag: 'svelte-playground' })
</script>

<h1>Fingerly — Svelte binding</h1>

<div class="bar">
  <button onclick={() => void fingerly.refresh().catch(() => undefined)}>refresh()</button>
  <span class="status">{fingerly.isLoading ? 'collecting…' : fingerly.isReady ? 'ready' : 'idle'}</span>
</div>

<div class="card">
  <h3>state</h3>
  <div class="row"><span class="k">suspectScore</span><span class="v">{fingerly.suspectScore ?? 'hidden'}</span></div>
  <div class="row"><span class="k">suspectLevel</span><span class="v" class:hit={fingerly.suspectLevel === 'high'}>{fingerly.suspectLevel ?? 'hidden'}</span></div>
  <div class="row"><span class="k">requestId</span><span class="v">{fingerly.requestId ?? '— (submit: false)'}</span></div>
  <div class="row"><span class="k">identified</span><span class="v">{fingerly.identified}</span></div>
  <div class="row"><span class="k">report</span><span class="v">not kept in state (collect() to inspect)</span></div>
  {#if fingerly.error}
    <div class="row"><span class="k">error</span><span class="v hit">{fingerly.error.message}</span></div>
  {/if}
</div>

<div class="grid">
  <Score />
</div>
