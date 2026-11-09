/**
 * The Vue binding, driving the real SDK in a real browser.
 *
 * The unit tests mock `@fingerly/web-js`, which is right for testing the Vue
 * layer and proves nothing about the two fitting together. This does the
 * opposite: no mocks, the real collectors, and the composables used exactly as
 * the README documents them.
 *
 * Render functions rather than templates, so the demo needs only Vue's runtime
 * and not the template compiler.
 *
 * It uses `submit: false`, so no server answers: the raw report fills in and
 * the score, level and triggers stay empty, as they must with nobody to ask.
 */

import { createApp, defineComponent, h } from 'vue'

import { createFingerly, useIdentify } from '../src/index.js'

const row = (label: string, value: unknown, className = '') =>
  h('div', { class: `row ${className}` }, [
    h('span', { class: 'k' }, label),
    h('span', { class: 'v' }, String(value)),
  ])

/** What the server scored on, to show a second reader of the same identification. */
const TriggersCard = defineComponent({
  setup() {
    const { triggers, suspectLevel } = useIdentify({ tag: () => 'vue-demo' })
    return () =>
      h('div', { class: 'card' }, [
        h('h3', 'triggers'),
        row('level', suspectLevel.value ?? '—', suspectLevel.value === 'high' ? 'hit' : ''),
        triggers.value.length
          ? h(
              'ul',
              { class: 'reasons' },
              triggers.value.map((trigger) =>
                h('li', { key: trigger.signal }, `${trigger.signal} (${trigger.group})`),
              ),
            )
          : row('fired', '—'),
      ])
  },
})

const App = defineComponent({
  setup() {
    // `immediate` in the root only - the plugin shares one result, so the card
    // below reads this same submission.
    const { identify, refresh, requestId, report, suspectScore, suspectLevel, isLoading, isReady, error } =
      useIdentify({ immediate: true, tag: () => 'vue-demo' })

    return () =>
      h('div', [
        h('h1', 'Fingerly — Vue binding'),
        h('div', { class: 'bar' }, [
          h('button', { onClick: () => void identify().catch(() => undefined) }, 'identify()'),
          h('button', { onClick: () => void refresh().catch(() => undefined) }, 'refresh()'),
          h('span', { class: 'status' }, isLoading.value ? 'collecting…' : isReady.value ? 'ready' : 'idle'),
        ]),
        error.value ? h('p', { class: 'err' }, error.value.message) : null,
        h('div', { class: 'card' }, [
          h('h3', 'state'),
          row('isLoading', isLoading.value),
          row('isReady', isReady.value),
          row('suspectScore', suspectScore.value ?? '— (no server answer)'),
          row('suspectLevel', suspectLevel.value ?? '— (no server answer)', suspectLevel.value === 'high' ? 'hit' : ''),
          row('requestId', requestId.value ?? '— (submit: false)'),
          row('sources', report.value ? Object.keys(report.value.sources).length : '—'),
          row('elapsed_ms', report.value?.elapsed_ms ?? '—'),
          row('engine', report.value?.integrity.engine.observed ?? '—'),
        ]),
        h('div', { class: 'grid' }, [h(TriggersCard)]),
      ])
  },
})

const app = createApp(App)

// submit: false - the demo collects and sends nothing.
app.use(createFingerly({ apiKey: 'pk_demo', submit: false }))
app.mount('#app')

// Read back by the browser check. The context carries the shared state, so a
// diagnostic can see exactly what every component is seeing.
;(window as unknown as { __fingerlyApp: unknown }).__fingerlyApp = app
;(window as unknown as { __fingerly: unknown }).__fingerly =
  app.config.globalProperties.$fingerly
