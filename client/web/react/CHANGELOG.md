# Changelog

## 0.1.2

- The `endpoint` prop and option and the `reason` state are gone; use `endpoints`.
- Uses @fingerly/web-js 0.1.2.

## 0.1.1

- `isSuspicious` comes from the server's `suspectLevel`: `true` for `medium` or `high`, `false` for `low`, `null` when the level is absent (before identification, `submit: false`, unscored, or hidden by the SDK key), never `false`. It is typed `boolean | null`.
- `useVerdict()`, `verdicts` and `triggers` are removed. `suspectScore` and `suspectLevel` can be absent even on a submitted event (the SDK key can hide them), in which case they are `null`. Read signals on your backend.
- The provider keys its store on the contents of `endpoints`, so an array literal, or one a Server Component sends again on `router.refresh()`, no longer rebuilds the store and identifies again on every render.
- A failed identification holds off the next: a `Retry-After` holds every call until it passes, and a transient failure holds automatic (`immediate`, `suspend`) identifications for 5 s, doubling to a minute. Route changes during an outage or a 429 send nothing.
- A client that cannot be built (a missing key) lands in `error` instead of unmounting the React root.
- `reason` is deprecated and always `null`, never `undefined`: a browser is no longer told why a check went unscored. Your backend reads it on the server-side event read, by `requestId`.
- Uses @fingerly/web-js 0.1.1.

## 0.1.0

- First public release.
