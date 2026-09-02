<script lang="ts">
  import { setupBadele, useIdentify, type VerdictName } from '../src/index.js'
  import Verdict from './Verdict.svelte'

  const NAMES: VerdictName[] = ['incognito', 'shields', 'tor', 'emulator', 'automation', 'farm']

  // submit: false - the playground collects and scores locally, and sends
  // nothing.
  setupBadele({ apiKey: 'pk_demo', submit: false })

  const badele = useIdentify({ immediate: true, tag: 'svelte-playground' })
</script>

<h1>Badele — Svelte binding</h1>

<div class="bar">
  <button onclick={() => void badele.refresh().catch(() => undefined)}>refresh()</button>
  <span class="status">{badele.isLoading ? 'collecting…' : badele.isReady ? 'ready' : 'idle'}</span>
</div>

<div class="card">
  <h3>state</h3>
  <div class="row"><span class="k">isSuspicious</span><span class="v" class:hit={badele.isSuspicious}>{badele.isSuspicious}</span></div>
  <div class="row"><span class="k">requestId</span><span class="v">{badele.requestId ?? '— (submit: false)'}</span></div>
  <div class="row"><span class="k">sources</span><span class="v">{badele.report ? Object.keys(badele.report.sources).length : '—'}</span></div>
  <div class="row"><span class="k">elapsed_ms</span><span class="v">{badele.report?.elapsed_ms ?? '—'}</span></div>
  <div class="row"><span class="k">engine</span><span class="v">{badele.report?.integrity.engine.observed ?? '—'}</span></div>
  {#if badele.error}
    <div class="row"><span class="k">error</span><span class="v hit">{badele.error.message}</span></div>
  {/if}
</div>

<div class="grid">
  {#each NAMES as name (name)}<Verdict {name} />{/each}
</div>
