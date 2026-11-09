# Changelog

## 0.2.0

The SDK collects and sends; every decision moved to the server.

- The contradiction checks (`findContradictions`) and `engine.agrees` are gone from the report. The server compares the raw values itself.
- `permissions.inconsistent` is no longer sent.
- `media_devices` moved to the fast tier (120 ms cap), and the motion-sensor presence check moved onto `touch`, so the server's rules see them in the report it scores.
- `IdentifyResult.verdicts` is deprecated and derived from the server's `triggers`; see `@fingerly/core`.

## 0.1.1

- `load()` rejects for a configuration mistake (a missing key, conflicting endpoint options) instead of throwing synchronously, so a misconfiguration cannot take a page down.
- Each permission is queried once per page and read live, which stops Chromium retaining two `PermissionStatus` objects per identification.
- The README documents first-party proxies (`endpoints`), Content Security Policy and `retryAfterMs`.
- `IdentifyResult.reason` is deprecated and `undefined`: a browser is no longer told why a submission went unscored. Your backend reads `reason` on the server-side event read, by `requestId`.
- Uses @fingerly/core 0.1.1.

## 0.1.0

- First public release.
