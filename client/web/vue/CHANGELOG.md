# Changelog

## 0.1.1

- A failed identification holds off the next, as in the React binding: `Retry-After` holds every call, and a transient failure holds automatic identifications for 5 s, doubling to a minute.
- A client that cannot be built lands in `error` instead of failing the app's mount.
- `isSuspicious` no longer counts the `shields` verdict. It says a privacy browser is rewriting some values, which is never a reason to challenge anyone, so a privacy-conscious visitor no longer reads as suspicious on that alone. The other five verdicts count as before.
- `reason` is deprecated and always `null`, never `undefined`: a browser is no longer told why a check went unscored. Your backend reads it on the server-side event read, by `requestId`.
- Uses @fingerly/web-js 0.1.1.

## 0.1.0

- First public release.
