# Changelog

## 0.5.1

- Uses @fingerly/web-js 0.5.1: the extended private-window check is waited
  for on the first identification of a visit.

## 0.5.0

- Uses @fingerly/web-js 0.5.0: opt-in session continuity, more reliable
  identification on a browser that has just started, and the extended
  incognito probe started as soon as consent allows collection.
- Takes the `continuity` module option (`'none'` by default, or
  `'session'`), passed to the client.

## 0.4.0

- Uses @fingerly/web-js 0.4.0, which exports runtime constants for the
  fixed contract values such as `SuspectLevel` and `Signal`.

## 0.3.0

- Consent comes only from `setConsent()` at runtime. It is not published in
  the runtime config, so neither `nuxt.config` nor
  `NUXT_PUBLIC_FINGERLY_CONSENT` can grant it; a static value other than
  `pending` warns at build time and is ignored.
- The README samples make the enforcement decision on the backend, from the
  verified event.
- Uses @fingerly/vue 0.3.0.

## 0.2.0

- Uses @fingerly/vue 0.2.0, which keeps the browser SDK from collecting inside an app's web view.

## 0.1.2

- The `fingerly.endpoint` option and `NUXT_PUBLIC_FINGERLY_ENDPOINT` are gone; use `fingerly.endpoints` or `NUXT_PUBLIC_FINGERLY_ENDPOINTS`. There is no `reason` ref.
- Uses @fingerly/vue 0.1.2.

## 0.1.1

- From `@fingerly/vue` 0.1.1: `isSuspicious` comes from the server's `suspectLevel` and is `null` when the level is absent; `useVerdict()`, `verdicts` and `triggers` are removed, and `useVerdict` is no longer auto-imported. Read signals on your backend.
- `endpoints` wins over the deprecated `endpoint`, so `NUXT_PUBLIC_FINGERLY_ENDPOINT` beside `fingerly.endpoints` no longer stops the app from starting.
- The missing-key warning is logged once per process instead of twice per request.
- The README documents `NUXT_PUBLIC_FINGERLY_ENDPOINTS` and a Nitro proxy route.
- `reason` is deprecated and always `null`, from @fingerly/vue 0.1.1: a browser is no longer told why a check went unscored.
- Uses @fingerly/vue 0.1.1, with its fixes.

## 0.1.0

- First public release.
