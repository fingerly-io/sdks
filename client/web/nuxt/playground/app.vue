<script setup lang="ts">
const { suspectScore, suspectLevel, triggers, isReady } = useIdentify({ immediate: true })
const config = useRuntimeConfig()
</script>

<template>
  <main>
    <h1>Fingerly — Nuxt module</h1>
    <p id="key">key: {{ config.public.fingerly.apiKey || '(unset)' }}</p>
    <p id="state">ready: {{ isReady }} · score: {{ suspectScore ?? 'no server answer' }} · level: {{ suspectLevel ?? 'no server answer' }}</p>
    <pre id="triggers">{{ triggers.length ? triggers.map((t) => t.signal).join(' ') : 'none' }}</pre>
  </main>
</template>
