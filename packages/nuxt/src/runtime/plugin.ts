import { createFingerly } from '@fingerly/vue'
import { defineNuxtPlugin, useRuntimeConfig } from '#app'

import { toVueOptions } from './config.js'

/**
 * Install the Vue plugin, on both the server and the client.
 *
 * Nothing is collected here. `createFingerly()` makes the client reachable and
 * no more, which is what makes it safe to install during a server render: a
 * page can call `useIdentify()` in `setup()` on the server, render its "not
 * yet identified" state, and collect after hydration in `onMounted`.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig().public.fingerly

  nuxtApp.vueApp.use(createFingerly(toVueOptions(config)))
})
