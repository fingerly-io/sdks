# Changelog

## Unreleased

- Under the default budget an identity-critical source is no longer stopped
  by its own `timeoutMs`: it runs until it answers or the grace period ends,
  and `DEFAULT_GRACE_MS` is now 2150 ms, so the run ends at most 2.5 s after
  it starts. `SourceContext.budgetRemainingMs()` reports the time left until
  that end. A warm browser still finishes in tens of milliseconds; a budget
  the caller chose is still a ceiling, and keeps each source's own timeout.

## 0.5.3

- Adds `geometry_high`, `text_high` and `text_metrics_width` to `CanvasSignal`,
  `render_hash` and `shader_blocked` to `WebGLSignal`, and `crest_ratio`,
  `shape_ratio`, `decay_ratio` and `negative_samples` to `AudioSignal` for
  session-invariant Brave Shields recovery and strict-mode detection.

## 0.5.2

- Released with @fingerly/web-js 0.5.2. No change of its own.

## 0.5.1

- Released with @fingerly/web-js 0.5.1. No change of its own.

## 0.5.0

- Opt-in session continuity: `continuity: 'session'` (the `Continuity`
  constant, `'none'` by default) keeps the signed session seal of the last
  answer in `sessionStorage` under `SEAL_STORAGE_KEY` and sends it with the
  next report of the tab. The seal is read and written only while consent is
  granted, and removed when consent is denied.
- Identity-critical sources (`Source.identityCritical`) start first in their
  stage and, under the default budget, may run up to `DEFAULT_GRACE_MS`
  (400 ms) past it (`ScheduleOptions.graceMs`).
- New signal types for the sources that read the same in a private window:
  `WebGL2Signal`, `WebGPUSignal`, `VoicesSignal`, `CodecsSignal` and
  `ApplePaySignal`.
- Re-exports the `Continuity` constant of `@fingerly/types` 0.5.0.

## 0.4.0

- Re-exports the runtime constants of `@fingerly/types` 0.4.0: `Signal`,
  `SuspectLevel`, `Confidence`, `EventState`, `ConsentState`,
  `IncognitoDetection` and `SdkPlatform`.
- The signal list matches the server: `repeated_reinstall`,
  `device_activity_high` and `device_activity_very_high` are added and
  `app_attest_key_churn` is gone.

## 0.3.0

- `identify()` collects and submits in one `v: 3` round trip and resolves
  without the signal report, which `collect()` returns.
- Web freshness ticket: the ticket request starts with collection, in
  parallel, and a held `next_ticket` with more than 10 seconds left is used
  instead. When the request fails or is slower than 250 ms after collection
  the report goes without a ticket; `identify()` never waits longer or fails
  because of it. A requested ticket that arrives late is kept for the next
  report, ahead of a `next_ticket`. Tickets live in memory only.
- Proof of work: when a ticket carries `pow_bits`, the smallest decimal
  nonce whose `SHA256(ticket:nonce)` has that many leading zero bits is sent
  as `ticket_pow`. Solving starts when the ticket arrives, runs in a blob
  Worker when allowed and in time slices otherwise, and stops at 1500 ms,
  after which the report goes without `ticket_pow`. The SHA-256 is a compact
  synchronous one with no dependency.
- Refuses to submit without a secure random `Idempotency-Key`: without
  `crypto.randomUUID` or `crypto.getRandomValues` the call fails with
  `TransportError` code `no_secure_random` before any request is made.
- Options, source fields and the parsed answer are read as own properties
  only, so a polluted `Object.prototype` cannot change which sources run, the
  budget, the tag, the result or where the report is sent.
- No source evaluates code, so no source needs `unsafe-eval` and a strict
  CSP raises no violation. The errors source reports `regexp_syntax_length`
  and `redefine_length`.
- The integrity pass inspects the borrow primitives, the window navigator and
  screen accessors and the APIs the collectors read, verifies the borrowed
  realm before trusting it, and records a throwing getter as an
  `unverified_realm` lie instead of rejecting.
- `shields` sends the observations behind its booleans: `brave_api`,
  `brands`, and the canary comparison (`canary_pixels`, `canary_mismatched`,
  `canary_max_delta`).
- A worker blocked by CSP is detected by attempting it; a CSP meta counts only
  as a child of `head`. The worker wait is the remaining budget
  (`gpu_unanswered` when only the navigator values arrive).
- Inside an app's web view only `engine`, `math`, `errors`, `navigator`,
  `worker_realm` and `automation` run, and `navigator` sends `user_agent`,
  `platform` and `webdriver`.
- Collects only what the server reads: no `plugins` source (the navigator's
  `plugin_count` stays), no `math.hash`, no `automation.chrome_object`, and
  only the `architecture` client hint.
- Uses @fingerly/types 0.3.0.

## 0.2.0

- New `embedding` client option: a detector supplied by the platform SDK. When it names a kind of in-app web view, no source and no integrity check runs, the report carries only the `embedding` source, and no deferred report follows (`deferred` is `skipped` with `not-submitted`). It is asked only once consent is granted. One console warning per page.
- `SOURCE.embedding` and `EmbeddingSignal`.

## 0.1.2

- Custom ingestion URLs are configured with `endpoints` only; there is no `endpoint` option. The result has no `reason`, and the report types have no `engine.agrees` or `permissions.inconsistent`.
- Uses @fingerly/types 0.1.2.

## 0.1.1

Every decision moved to the server. This package collects and transports; it no longer scores, thresholds or concludes anything.

- Removed: `detectAll`, every `detect*`, `weigh`, `unknown`, `farblesFingerprints`, `trustedDeviceMemory`, `BRAVE_SYNTHETIC_QUOTA`, `Evidence`, `Verdict`, `Verdicts`, `IdentifyTrigger`, and `verdicts` and `triggers` on the result and on `deferred`. Read `suspectLevel` in the page, and read signals on your backend.
- A public caller is not sent signal names, and an SDK key can hide `suspectScore` and `suspectLevel` from the page. Both stay `null` when absent, never zero or invented, and malformed scores or levels read as absent rather than throw. Signal names a backend proxy passes through are ignored.
- `identify({ submit: false })` returns only the raw report; everything the server decides is empty.
- `isSuspiciousLevel` is `null` when the level is absent or not one it knows; only `low` is `false`.
- The `engine.agrees`, `permissions.inconsistent` and `integrity.lies` of kind `contradiction` fields are no longer computed; the server compares the raw values itself.
- A `429` or `503` with `Retry-After` is honoured: a wait of up to 2 s is taken, plus a random spread, before the retry; a longer one ends the call, and `TransportError.retryAfterMs` carries it. Retries reuse the first attempt's idempotency key.
- A call cancelled while it waits to retry (its signal aborted, or consent withdrawn) rejects at once instead of when the wait ends.
- Only `408`, `429` and `5xx` are retried. A `404` or `405` moves on to the next configured endpoint once and is never asked of the same endpoint again.
- A `2xx` that is not this API's JSON, or is over 4 MiB, is not retried, and the error message never quotes its body.
- The deferred supplement's answer is read to the end, which stops Chromium keeping about 7 KB per identification for the life of the page.
- `JSON.stringify` and `util.inspect` of a `FingerlyClient` or `HttpTransport` show `[redacted]` instead of the SDK key.
- `sdk.version` reports 0.1.1.
- `IdentifyResult.reason` is no longer set, from the server's answer or for `identify({ submit: false })`, which said `not-submitted`; that case is still `deferred`'s `not-submitted`. The server tells only a secret key why a submission went unscored, and your backend reads it on the event.

## 0.1.0

- First public release.
