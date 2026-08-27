/**
 * The Vue binding, driving the real SDK in a real browser.
 *
 * The unit tests mock `@badele/web-js`, which is right for testing the Vue
 * layer and proves nothing about the two fitting together. This does the
 * opposite: no mocks, the real collectors, and the composables used exactly as
 * the README documents them.
 *
 * Render functions rather than templates, so the demo needs only Vue's runtime
 * and not the template compiler.
 */

import { createApp, defineComponent, h } from 'vue'

import { createBadele, useIdentify, useVerdict } from '../src/index.js'

const row = (label: string, value: unknown, className = '') =>
  h('div', { class: `row ${className}` }, [
    h('span', { class: 'k' }, label),
    h('span', { class: 'v' }, String(value)),
  ])

/** Reads one verdict, to show `useVerdict()` sharing the same identification. */
const VerdictCard = defineComponent({
  props: { name: { type: String, required: true } },
  setup(props) {
    const { matched, confidence, reasons } = useVerdict(
      () => props.name as 'automation' | 'tor' | 'incognito' | 'emulator' | 'farm',
    )
    return () =>
      h('div', { class: 'card' }, [
        h('h3', props.name),
        row('matched', matched.value, matched.value ? 'hit' : ''),
        row('confidence', confidence.value ?? '—'),
        reasons.value.length
          ? h(
              'ul',
              { class: 'reasons' },
              reasons.value.map((reason) => h('li', { key: reason }, reason)),
            )
          : null,
      ])
  },
})

const App = defineComponent({
  setup() {
    // `immediate` in the root, and again in every card below - the plugin
    // shares one result, so this is still one submission.
    const { identify, refresh, requestId, report, verdicts, isLoading, isReady, isSuspicious, error } =
      useIdentify({ immediate: true, tag: () => 'vue-demo' })

    return () =>
      h('div', [
        h('h1', 'Badele — Vue binding'),
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
          row('isSuspicious', isSuspicious.value, isSuspicious.value ? 'hit' : ''),
          row('requestId', requestId.value ?? '— (submit: false)'),
          row('sources', report.value ? Object.keys(report.value.sources).length : '—'),
          row('elapsed_ms', report.value?.elapsed_ms ?? '—'),
          row('engine', report.value?.integrity.engine.observed ?? '—'),
          row('verdict keys', verdicts.value ? Object.keys(verdicts.value).join(', ') : '—'),
        ]),
        h(
          'div',
          { class: 'grid' },
          ['incognito', 'tor', 'emulator', 'automation', 'farm'].map((name) =>
            h(VerdictCard, { name, key: name }),
          ),
        ),
      ])
  },
})

const app = createApp(App)

// submit: false - the demo collects and scores locally, and sends nothing.
app.use(createBadele({ apiKey: 'pk_demo', submit: false }))
app.mount('#app')

// Read back by the browser check. The context carries the shared state, so a
// diagnostic can see exactly what every component is seeing.
;(window as unknown as { __badeleApp: unknown }).__badeleApp = app
;(window as unknown as { __badele: unknown }).__badele =
  app.config.globalProperties.$badele
