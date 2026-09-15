<script setup lang="ts">
const { verdicts, isReady, isSuspicious } = useIdentify({ immediate: true })
const { matched, reasons } = useVerdict('incognito')
const config = useRuntimeConfig()
</script>

<template>
  <main>
    <h1>Fingerly — Nuxt module</h1>
    <p id="key">key: {{ config.public.fingerly.apiKey || '(unset)' }}</p>
    <p id="state">ready: {{ isReady }} · suspicious: {{ isSuspicious }}</p>
    <p id="incognito">incognito: {{ matched }} {{ reasons.join(', ') }}</p>
    <pre id="verdicts">{{ verdicts ? Object.keys(verdicts).join(' ') : 'none yet' }}</pre>
  </main>
</template>
