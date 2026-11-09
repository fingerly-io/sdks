# Changelog

## 0.1.1

- `isSuspicious` comes from the server's `suspectLevel`: `true` for `medium` or `high`, `false` for `low`, `null` when the level is absent (before identification, `submit: false`, unscored, or hidden by the SDK key), never `false`. It is typed `boolean | null`.
- `useVerdict()`, `verdicts` and `triggers` are removed. `suspectScore` and `suspectLevel` can be absent even on a submitted event (the SDK key can hide them), in which case they are `null`. Read signals on your backend.
- A failed identification holds off the next, as in the other bindings.
- A client that cannot be built lands in `error`, and `isLoading` no longer stays true.
- No source maps are shipped; they pointed at sources the package does not include.
- The README's layout uses `{@render children()}` and shows a SvelteKit proxy endpoint.
- `reason` is deprecated and always `null`, never `undefined`: a browser is no longer told why a check went unscored. Your backend reads it on the server-side event read, by `requestId`.
- Uses @fingerly/web-js 0.1.1.

## 0.1.0

- First public release.
