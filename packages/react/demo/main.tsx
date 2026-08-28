/**
 * The React binding, driving the real SDK in a real browser.
 *
 * The unit tests mock `@badele/web-js`, which is right for testing the React
 * layer and proves nothing about the two fitting together. This does the
 * opposite: no mocks, the real collectors, and the hooks used exactly as the
 * README documents them.
 *
 * Open it twice - an ordinary window and a private one - and watch the
 * incognito card change. That pair is the only real test the verdict gets.
 */

import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'

import { BadeleProvider, useIdentify, useVerdict, type VerdictName } from '../src/index.js'

const NAMES: VerdictName[] = ['incognito', 'tor', 'emulator', 'automation', 'farm']

function Row({ label, value, hit = false }: { label: string; value: unknown; hit?: boolean }) {
  return (
    <div className="row">
      <span className="k">{label}</span>
      <span className={hit ? 'v hit' : 'v'}>{String(value)}</span>
    </div>
  )
}

/** One verdict, to show `useVerdict()` reading the shared identification. */
function VerdictCard({ name }: { name: VerdictName }) {
  const { matched, confidence, reasons } = useVerdict(name)

  return (
    <div className="card">
      <h3>{name}</h3>
      <Row label="matched" value={matched} hit={matched} />
      <Row label="confidence" value={confidence ?? '—'} />
      {reasons.length > 0 && (
        <ul className="reasons">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The state card, and the only component that asks for an identification.
 *
 * `suspend` rather than `immediate`, so the page shows what React's Suspense
 * does with this: the fallback below renders while the collectors run, and
 * every card appears at once with an answer rather than flickering through an
 * empty state.
 */
function Report() {
  const { requestId, report, isSuspicious, refresh } = useIdentify({ suspend: true, tag: 'react-demo' })

  return (
    <>
      <div className="bar">
        <button onClick={() => void refresh().catch(() => undefined)}>refresh()</button>
        <span className="status">ready</span>
      </div>
      <div className="card">
        <h3>state</h3>
        <Row label="isSuspicious" value={isSuspicious} hit={isSuspicious} />
        <Row label="requestId" value={requestId ?? '— (submit: false)'} />
        <Row label="sources" value={report ? Object.keys(report.sources).length : '—'} />
        <Row label="elapsed_ms" value={report?.elapsed_ms ?? '—'} />
        <Row label="engine" value={report?.integrity.engine.observed ?? '—'} />
      </div>
      <div className="grid">
        {NAMES.map((name) => (
          <VerdictCard key={name} name={name} />
        ))}
      </div>
    </>
  )
}

function App() {
  return (
    <>
      <h1>Badele — React binding</h1>
      {/* submit: false - the demo collects and scores locally, and sends nothing. */}
      <BadeleProvider apiKey="pk_demo" submit={false}>
        <Suspense fallback={<p className="status">collecting…</p>}>
          <Report />
        </Suspense>
      </BadeleProvider>
    </>
  )
}

const container = document.getElementById('app')
if (container) {
  // StrictMode deliberately, because it double-mounts every component in
  // development and this page is the proof that costs one identification.
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
