# Changelog

## 0.2.0

- `isSuspicious` comes from the server's `suspectLevel`: `true` for `medium` or `high`, `false` for `low`, `null` when no server answered (before identification, `submit: false`, or unscored). It is typed `boolean | null`.
- `verdicts` and `useVerdict()` are deprecated, warn once in development, and are derived from the server's `triggers`. `matched` is `boolean | null`, `null` when no server answered.
- `triggers[].weight` no longer reaches the browser.

## 0.1.1

- A failed identification holds off the next, as in the other bindings.
- A client that cannot be built lands in `error`, and `isLoading` no longer stays true.
- No source maps are shipped; they pointed at sources the package does not include.
- The README's layout uses `{@render children()}` and shows a SvelteKit proxy endpoint.
- `isSuspicious` no longer counts the `shields` verdict. It says a privacy browser is rewriting some values, which is never a reason to challenge anyone, so a privacy-conscious visitor no longer reads as suspicious on that alone. The other five verdicts count as before.
- `reason` is deprecated and always `null`, never `undefined`: a browser is no longer told why a check went unscored. Your backend reads it on the server-side event read, by `requestId`.
- Uses @fingerly/web-js 0.1.1.

## 0.1.0

- First public release.
