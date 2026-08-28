'use client'

import { useActionState } from 'react'

import { BadeleRequestId, useIdentify, useVerdict, type VerdictName } from '@badele/next'
import { submit } from './actions'

const NAMES: VerdictName[] = ['incognito', 'tor', 'emulator', 'automation', 'farm']

const card = {
  background: '#171a21',
  border: '1px solid #262b36',
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
} as const

function Row({ label, value, hit = false }: { label: string; value: unknown; hit?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '2px 0' }}>
      <span style={{ color: '#8b93a7' }}>{label}</span>
      <span style={{ color: hit ? '#f87171' : '#e6e8ee', fontWeight: hit ? 700 : 400 }}>
        {String(value)}
      </span>
    </div>
  )
}

function Verdict({ name }: { name: VerdictName }) {
  const { matched, confidence, reasons } = useVerdict(name)

  return (
    <div style={card}>
      <h3 style={{ fontSize: 11, margin: '0 0 8px', color: '#8b93a7', textTransform: 'uppercase' }}>
        {name}
      </h3>
      <Row label="matched" value={matched} hit={matched} />
      <Row label="confidence" value={confidence ?? '—'} />
      {reasons.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 16, color: '#8b93a7', fontSize: 11 }}>
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Page() {
  const badele = useIdentify({ immediate: true, tag: 'next-demo' })
  const [result, action, pending] = useActionState(submit, null)

  return (
    <>
      <h1 style={{ fontSize: 16, margin: '0 0 16px' }}>Badele — Next binding</h1>

      <div style={card}>
        <h3 style={{ fontSize: 11, margin: '0 0 8px', color: '#8b93a7', textTransform: 'uppercase' }}>
          state
        </h3>
        <Row label="isReady" value={badele.isReady} />
        <Row label="isSuspicious" value={badele.isSuspicious} hit={badele.isSuspicious} />
        <Row label="requestId" value={badele.requestId ?? '— (submit: false)'} />
        <Row label="sources" value={badele.report ? Object.keys(badele.report.sources).length : '—'} />
        <Row label="elapsed_ms" value={badele.report?.elapsed_ms ?? '—'} />
        <Row label="engine" value={badele.report?.integrity.engine.observed ?? '—'} />
        {badele.error && <Row label="error" value={badele.error.message} hit />}
      </div>

      {/*
        The half no unit test can show: the field travels with the submission,
        and the action - which runs on the server, where the browser is not -
        reads it back with readRequestId().
      */}
      <form action={action} style={card}>
        <h3 style={{ fontSize: 11, margin: '0 0 8px', color: '#8b93a7', textTransform: 'uppercase' }}>
          server action
        </h3>
        <input
          name="email"
          placeholder="you@example.com"
          defaultValue="you@example.com"
          style={{
            font: 'inherit',
            background: '#0f1115',
            color: '#e6e8ee',
            border: '1px solid #262b36',
            borderRadius: 6,
            padding: '6px 10px',
            marginRight: 8,
          }}
        />
        <BadeleRequestId />
        <button
          type="submit"
          disabled={pending}
          style={{
            font: 'inherit',
            background: '#171a21',
            color: '#7dd3fc',
            border: '1px solid #7dd3fc',
            borderRadius: 6,
            padding: '6px 12px',
            cursor: 'pointer',
          }}
        >
          {pending ? 'submitting…' : 'submit()'}
        </button>

        {result && (
          <div style={{ marginTop: 12 }} id="action-result">
            <Row label="server read requestId" value={result.requestId ?? 'null'} />
            <Row label="raw field" value={result.raw} />
            <Row label="email" value={result.email} />
          </div>
        )}
      </form>

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}
      >
        {NAMES.map((name) => (
          <Verdict key={name} name={name} />
        ))}
      </div>
    </>
  )
}
