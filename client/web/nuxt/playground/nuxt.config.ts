export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',
  modules: ['../src/module'],
  fingerly: { consent: 'granted' },
  telemetry: false,
  devtools: { enabled: false },
})
