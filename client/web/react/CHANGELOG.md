# Changelog

## 0.2.0

- `isSuspicious` comes from the server's `suspectLevel`: `true` for `medium` or `high`, `false` for `low`, `null` when the level is absent (before identification, `submit: false`, unscored, or hidden by the SDK key), never `false`. It is typed `boolean | null`.
- `verdicts` and `useVerdict()` are deprecated and warn once in development. They hold nothing now: `matched` is `null` on any response, never a clean `false`. The warning says to read signals on your backend.
- `triggers[].weight` no longer reaches the browser.
- Follows the public response change: `triggers` is deprecated and empty from a public key, and `suspectScore` and `suspectLevel` can be absent even on a submitted event (the SDK key can hide them), in which case they are `null`. Read signals on your backend.

## 0.1.1

- The provider keys its store on the contents of `endpoints`, so an array literal, or one a Server Component sends again on `router.refresh()`, no longer rebuilds the store and identifies again on every render.
- A failed identification holds off the next: a `Retry-After` holds every call until it passes, and a transient failure holds automatic (`immediate`, `suspend`) identifications for 5 s, doubling to a minute. Route changes during an outage or a 429 send nothing.
- A client that cannot be built (a missing key) lands in `error` instead of unmounting the React root.
- `isSuspicious` no longer counts the `shields` verdict. It says a privacy browser is rewriting some values, which is never a reason to challenge anyone, so a privacy-conscious visitor no longer reads as suspicious on that alone. The other five verdicts count as before.
- `reason` is deprecated and always `null`, never `undefined`: a browser is no longer told why a check went unscored. Your backend reads it on the server-side event read, by `requestId`.
- Uses @fingerly/web-js 0.1.1.

## 0.1.0

- First public release.
