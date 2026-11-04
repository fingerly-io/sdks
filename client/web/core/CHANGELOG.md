# Changelog

## 0.1.1

- A `429` or `503` with `Retry-After` is honoured: a wait of up to 2 s is taken before the one retry, a longer one ends the call, and `TransportError.retryAfterMs` carries it. Retries reuse the first attempt's idempotency key.
- Only `408`, `429` and `5xx` are retried. A `404` or `405` moves on to the next configured endpoint once and is never asked of the same endpoint again.
- A `2xx` that is not this API's JSON, or is over 4 MiB, is not retried, and the error message never quotes its body.
- The deferred supplement's answer is read to the end, which stops Chromium keeping about 7 KB per identification for the life of the page.
- `JSON.stringify` and `util.inspect` of a `FingerlyClient` or `HttpTransport` show `[redacted]` instead of the SDK key.
- `sdk.version` reports 0.1.1.

## 0.1.0

- First public release.
