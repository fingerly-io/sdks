# Changelog

## 0.1.1

- `load()` rejects for a configuration mistake (a missing key, conflicting endpoint options) instead of throwing synchronously, so a misconfiguration cannot take a page down.
- Each permission is queried once per page and read live, which stops Chromium retaining two `PermissionStatus` objects per identification.
- The README documents first-party proxies (`endpoints`), Content Security Policy and `retryAfterMs`.
- Uses @fingerly/core 0.1.1.

## 0.1.0

- First public release.
