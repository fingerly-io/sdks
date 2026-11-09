/**
 * The React binding, driving the real SDK in a real browser.
 *
 * The unit tests mock `@fingerly/web-js`, which is right for testing the React
 * layer and proves nothing about the two fitting together. This does the
 * opposite: no mocks, the real collectors, and the hooks used exactly as the
 * README documents them.
 *
 * It uses `submit: false`, so no server answers: the raw report fills in and
 * the score and level read hidden, as they must with nobody to ask.
 */

import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'

import { FingerlyProvider, useIdentify } from '../src/index.js'

function Row({ label, value, hit = false }: { label: string; value: unknown; hit?: boolean }) {
  return (
    <div className="row">
      <span className="k">{label}</span>
      <span className={hit ? 'v hit' : 'v'}>{String(value)}</span>
    </div>
  )
}

/** The score and level again, to show a second reader of the shared identification. */
function ScoreCard() {
  const { suspectScore, suspectLevel } = useIdentify({ tag: 'react-demo' })

  return (
    <div className="card">
      <h3>result</h3>
      <Row label="score" value={suspectScore ?? 'hidden'} />
      <Row label="level" value={suspectLevel ?? 'hidden'} hit={suspectLevel === 'high'} />
      <Row label="signals" value="read on your backend" />
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
  const { requestId, report, suspectScore, suspectLevel, refresh } = useIdentify({ suspend: true, tag: 'react-demo' })

  return (
    <>
      <div className="bar">
        <button onClick={() => void refresh().catch(() => undefined)}>refresh()</button>
        <span className="status">ready</span>
      </div>
      <div className="card">
        <h3>state</h3>
        <Row label="suspectScore" value={suspectScore ?? 'hidden'} />
        <Row label="suspectLevel" value={suspectLevel ?? 'hidden'} hit={suspectLevel === 'high'} />
        <Row label="requestId" value={requestId ?? '— (submit: false)'} />
        <Row label="sources" value={report ? Object.keys(report.sources).length : '—'} />
        <Row label="elapsed_ms" value={report?.elapsed_ms ?? '—'} />
        <Row label="engine" value={report?.integrity.engine.observed ?? '—'} />
      </div>
      <div className="grid">
        <ScoreCard />
      </div>
    </>
  )
}

function App() {
  return (
    <>
      <h1>Fingerly — React binding</h1>
      {/* submit: false - the demo collects and sends nothing. */}
      <FingerlyProvider apiKey="pk_demo" submit={false}>
        <Suspense fallback={<p className="status">collecting…</p>}>
          <Report />
        </Suspense>
      </FingerlyProvider>
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
