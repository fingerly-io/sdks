<script lang="ts">
  import { setupFingerly, useIdentify, type VerdictName } from '../src/index.js'
  import Verdict from './Verdict.svelte'

  const NAMES: VerdictName[] = ['incognito', 'shields', 'tor', 'emulator', 'automation', 'farm']

  // submit: false - the playground collects and scores locally, and sends
  // nothing.
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
  <div class="row"><span class="k">isSuspicious</span><span class="v" class:hit={fingerly.isSuspicious}>{fingerly.isSuspicious}</span></div>
  <div class="row"><span class="k">requestId</span><span class="v">{fingerly.requestId ?? '— (submit: false)'}</span></div>
  <div class="row"><span class="k">sources</span><span class="v">{fingerly.report ? Object.keys(fingerly.report.sources).length : '—'}</span></div>
  <div class="row"><span class="k">elapsed_ms</span><span class="v">{fingerly.report?.elapsed_ms ?? '—'}</span></div>
  <div class="row"><span class="k">engine</span><span class="v">{fingerly.report?.integrity.engine.observed ?? '—'}</span></div>
  {#if fingerly.error}
    <div class="row"><span class="k">error</span><span class="v hit">{fingerly.error.message}</span></div>
  {/if}
</div>

<div class="grid">
  {#each NAMES as name (name)}<Verdict {name} />{/each}
</div>
