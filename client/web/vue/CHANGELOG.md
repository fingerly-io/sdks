# Changelog

## 0.1.1

- A failed identification holds off the next, as in the React binding: `Retry-After` holds every call, and a transient failure holds automatic identifications for 5 s, doubling to a minute.
- A client that cannot be built lands in `error` instead of failing the app's mount.
- Uses @fingerly/web-js 0.1.1.

## 0.1.0

- First public release.
