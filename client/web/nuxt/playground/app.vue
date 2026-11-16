<script setup lang="ts">
const { suspectScore, suspectLevel, isReady, consent } = useIdentify({ immediate: true })
const { setConsent } = useFingerly()
const config = useRuntimeConfig()
</script>

<template>
  <main>
    <h1>Fingerly — Nuxt module</h1>
    <!-- Consent is a visitor action, never configuration. -->
    <button v-if="consent !== 'granted'" id="consent" @click="setConsent('granted')">Accept</button>
    <p id="key">key: {{ config.public.fingerly.apiKey || '(unset)' }}</p>
    <p id="state">ready: {{ isReady }} · score: {{ suspectScore ?? 'hidden' }} · level: {{ suspectLevel ?? 'hidden' }}</p>
    <p id="signals">signals: read on your backend</p>
  </main>
</template>
