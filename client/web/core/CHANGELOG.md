# Changelog

## 0.2.0

Every decision moved to the server. This package collects and transports; it no longer scores, thresholds or concludes anything.

- `detectAll`, `detect*`, `weigh`, `unknown`, `farblesFingerprints` and `trustedDeviceMemory` are deprecated stubs that compute nothing and return an empty result (`value: null`, `reasons: []`), so an import does not break a build. They warn once in development. Read `suspectLevel` and `triggers` on the `identify()` result.
- `IdentifyResult.verdicts` is deprecated. It is a copy of the server's `triggers` and warns once in development when read. `Verdict.value` is `boolean | null`: `null` means no server answered (`submit: false`, or an unscored submission), which is not a clean result. `verdicts.shields` is always `null`: a browser's privacy protection is not a finding, so the server reports no signal for it.
- `identify({ submit: false })` now returns only the raw report. Nothing local fills in `verdicts`, and everything the server decides is empty.
- `triggers[].weight` is gone from the result, and `IdentifyTrigger.weight` is optional and deprecated. Customers' weights do not reach the browser; a secret-key backend reads them on the server-side event read.
- The `engine.agrees`, `permissions.inconsistent` and `integrity.lies` of kind `contradiction` fields are no longer computed; the server compares the raw values itself.
- `sdk.version` reports 0.2.0.

## 0.1.1

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
