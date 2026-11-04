# Changelog

## 0.1.1

- `load()` rejects for a configuration mistake (a missing key, conflicting endpoint options) instead of throwing synchronously, so a misconfiguration cannot take a page down.
- Each permission is queried once per page and read live, which stops Chromium retaining two `PermissionStatus` objects per identification.
- The README documents first-party proxies (`endpoints`), Content Security Policy and `retryAfterMs`.
- `IdentifyResult.reason` is deprecated and `undefined`: a browser is no longer told why a submission went unscored. Your backend reads `reason` on the server-side event read, by `requestId`.
- Uses @fingerly/core 0.1.1.

## 0.1.0

- First public release.
