# Changelog

## 0.1.1

- The provider keys its store on the contents of `endpoints`, so an array literal, or one a Server Component sends again on `router.refresh()`, no longer rebuilds the store and identifies again on every render.
- A failed identification holds off the next: a `Retry-After` holds every call until it passes, and a transient failure holds automatic (`immediate`, `suspend`) identifications for 5 s, doubling to a minute. Route changes during an outage or a 429 send nothing.
- A client that cannot be built (a missing key) lands in `error` instead of unmounting the React root.
- `isSuspicious` no longer counts the `shields` verdict. It says a privacy browser is rewriting some values, which is never a reason to challenge anyone, so a privacy-conscious visitor no longer reads as suspicious on that alone. The other five verdicts count as before.
- Uses @fingerly/web-js 0.1.1.

## 0.1.0

- First public release.
