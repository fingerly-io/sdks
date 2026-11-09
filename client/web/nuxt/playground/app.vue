<script setup lang="ts">
const { suspectScore, suspectLevel, isReady } = useIdentify({ immediate: true })
const config = useRuntimeConfig()
</script>

<template>
  <main>
    <h1>Fingerly — Nuxt module</h1>
    <p id="key">key: {{ config.public.fingerly.apiKey || '(unset)' }}</p>
    <p id="state">ready: {{ isReady }} · score: {{ suspectScore ?? 'hidden' }} · level: {{ suspectLevel ?? 'hidden' }}</p>
    <p id="signals">signals: read on your backend</p>
  </main>
</template>
