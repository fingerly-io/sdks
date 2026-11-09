# Changelog

## 0.2.0

- Follows `@fingerly/vue` 0.2.0: `isSuspicious` comes from the server's `suspectLevel` and is `null` when no server answered; `useVerdict()` and `verdicts` are deprecated and derived from the server's `triggers`.

## 0.1.1

- `endpoints` wins over the deprecated `endpoint`, so `NUXT_PUBLIC_FINGERLY_ENDPOINT` beside `fingerly.endpoints` no longer stops the app from starting.
- The missing-key warning is logged once per process instead of twice per request.
- The README documents `NUXT_PUBLIC_FINGERLY_ENDPOINTS` and a Nitro proxy route.
- `isSuspicious` no longer counts the `shields` verdict, from @fingerly/vue 0.1.1: a privacy browser alone never makes a session look suspicious.
- `reason` is deprecated and always `null`, from @fingerly/vue 0.1.1: a browser is no longer told why a check went unscored.
- Uses @fingerly/vue 0.1.1, with its fixes.

## 0.1.0

- First public release.
