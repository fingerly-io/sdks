# Changelog

## Unreleased

- New `embedding` client option: a detector supplied by the platform SDK. When it names a kind of in-app web view, no source and no integrity check runs, the report carries only the `embedding` source, and no deferred report follows (`deferred` is `skipped` with `not-submitted`). It is asked only once consent is granted. One console warning per page.
- `SOURCE.embedding` and `EmbeddingSignal`.
- Publish only after the server that recognises the `embedding` marker is deployed (server ADR 0024).

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
