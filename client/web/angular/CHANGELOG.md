# Changelog

## 0.6.0

- Uses @fingerly/web-js 0.6.0. `agentDetection: 'interaction'` passes through
  `provideFingerly({ agentDetection })`. With it on, the client is built as soon as consent is
  granted, so the counting starts there rather than at the first
  identification.

## 0.5.3

- Uses @fingerly/web-js 0.5.3: standard Brave Shields windows are recognised
  across normal, private and restarted sessions, and strict Brave mode is
  surfaced as `identity_obfuscated`.

## 0.5.2

- Uses @fingerly/web-js 0.5.2: Safari private windows are recognised on
  real HTTPS pages again.

## 0.5.1

- Uses @fingerly/web-js 0.5.1: the extended private-window check is waited
  for on the first identification of a visit.

## 0.5.0

- Uses @fingerly/web-js 0.5.0: opt-in session continuity, more reliable
  identification on a browser that has just started, and the extended
  incognito probe started as soon as consent allows collection.
- Takes the `continuity` option (`'none'` by default, or `'session'`) and
  re-exports the `Continuity` constant.

## 0.4.0

- Uses @fingerly/web-js 0.4.0, which exports runtime constants for the
  fixed contract values such as `SuspectLevel` and `Signal`.

## 0.3.0

- The state keeps no signal report; it exposes an `identified` signal once an
  identification has answered.
- No event types are re-exported: the server SDKs type the server's event read.
- The README samples make the enforcement decision on the backend, from the
  verified event.
- Uses @fingerly/web-js 0.3.0, which sends a single-use freshness ticket with
  every report.

## 0.2.0

- Uses @fingerly/web-js 0.2.0, which keeps the browser SDK from collecting inside an app's web view.

## 0.1.2

- The `endpoint` option and the `reason()` signal are gone; use `endpoints`.
- Uses @fingerly/web-js 0.1.2.

## 0.1.1

- `isSuspicious()` comes from the server's `suspectLevel`: `true` for `medium` or `high`, `false` for `low`, `null` when the level is absent (before identification, `submit: false`, unscored, or hidden by the SDK key), never `false`. It is typed `boolean | null`.
- `injectVerdict()`, `verdicts()` and `triggers()` are removed. `suspectScore()` and `suspectLevel()` can be absent even on a submitted event (the SDK key can hide them), in which case they are `null`. Read signals on your backend.
- A failed identification holds off the next, as in the other bindings.
- A client that cannot be built lands in `error()`, and `isLoading()` no longer stays true.
- No source maps are shipped; they pointed at sources the package does not include.
- `reason()` is deprecated and always `null`, never `undefined`: a browser is no longer told why a check went unscored. Your backend reads it on the server-side event read, by `requestId`.
- Uses @fingerly/web-js 0.1.1.

## 0.1.0

- First public release.
