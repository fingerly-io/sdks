# Changelog

## 0.1.1

- `endpoints` wins over the deprecated `endpoint`, so `NUXT_PUBLIC_FINGERLY_ENDPOINT` beside `fingerly.endpoints` no longer stops the app from starting.
- The missing-key warning is logged once per process instead of twice per request.
- The README documents `NUXT_PUBLIC_FINGERLY_ENDPOINTS` and a Nitro proxy route.
- `isSuspicious` no longer counts the `shields` verdict, from @fingerly/vue 0.1.1: a privacy browser alone never makes a session look suspicious.
- Uses @fingerly/vue 0.1.1, with its fixes.

## 0.1.0

- First public release.
