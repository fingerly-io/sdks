# Changelog

## 0.5.2

- The font sources run ahead of the slow ones. On a real HTTPS page
  Safari's Apple Pay check takes about 400 ms; with the other slow sources it
  kept the fonts from starting inside the budget, and a Safari private window
  that needs them to be recognised was reported as unidentifiable.

## 0.5.1

- With `incognitoDetection: 'extended'`, `identify()` called straight after
  `load()` waits for the private-window check instead of giving up after
  200 ms, within the collection budget and its grace period. The first
  identification of a visit in a fresh private window now carries it.

## 0.5.0

- Opt-in session continuity: `load({ continuity: 'session' })` carries an
  identified private window across the reports of one tab with a signed
  session seal in `sessionStorage`. Exports `Continuity` and
  `SEAL_STORAGE_KEY`.
- A browser that has just started identifies more reliably: the slow answers
  (speech voices, media codecs, the audio engine) are warmed as soon as
  consent allows collection, and the sources a device needs to be
  identifiable may run up to 400 ms past the default budget.
- New sources that read the same in a private window: WebGL 2 and WebGPU
  limits, speech voices, media codecs and Apple Pay availability.
- With `incognitoDetection: 'extended'`, the storage durability probe runs at
  its calibrated size and starts as soon as consent allows collection, so
  `identify()` reads its answer instead of waiting for it.
- Uses @fingerly/core 0.5.0 and @fingerly/types 0.5.0.

## 0.4.0

- Exports the runtime constants `Signal`, `SuspectLevel`, `Confidence`,
  `EventState`, `ConsentState`, `IncognitoDetection` and `SdkPlatform`, so
  `result.suspectLevel === SuspectLevel.High` works without raw strings.
- Uses @fingerly/core 0.4.0 and @fingerly/types 0.4.0.

## 0.3.0

- `identify()` collects and submits in one `v: 3` round trip and resolves
  without the signal report, which `collect()` returns.
- Sends a single-use web freshness ticket with every report and solves its
  proof of work when the key asks for one, without ever blocking or failing
  `identify()`. See `@fingerly/core` 0.3.0.
- Reads options, sources and answers as own properties only, needs no
  `unsafe-eval`, and collects only what the server reads (no `plugins`
  source). See `@fingerly/core` 0.3.0.
- No event types are exported: the server SDKs type the server's event read.
- Uses @fingerly/core 0.3.0.

## 0.2.0

- The browser SDK collects nothing inside an app's web view: iOS and macOS `WKWebView`, Android `WebView`, Capacitor, Cordova and Ionic, React Native WebView, Flutter web views and Electron. `identify()` sends only a marker naming the kind, after consent as always; use the iOS or Android SDK in apps. Other companies' in-app browsers (Instagram, Facebook, TikTok) are treated as browsers.
- `load()` always installs the detector; it cannot be turned off. `browserSources` used directly read nothing in a web view either (`unsupported`, reason `embedded`).
- New export: `detectEmbedding()`.

## 0.1.2

- `load()` takes custom ingestion URLs as `endpoints` only, and the result has no `reason`. See `@fingerly/core` 0.1.2.
- Uses @fingerly/core 0.1.2.

## 0.1.1

The SDK collects and sends; every decision moved to the server.

- The contradiction checks (`findContradictions`) and `engine.agrees` are gone from the report. The server compares the raw values itself.
- `permissions.inconsistent` is no longer sent.
- `media_devices` moved to the fast tier (120 ms cap), and the motion-sensor presence check moved onto `touch`, so the server's rules see them in the report it scores.
- `verdicts`, `triggers`, `Verdict`, `Verdicts` and `IdentifyTrigger` are removed; `suspectScore` and `suspectLevel` can be absent. See `@fingerly/core`.
- `load()` rejects for a configuration mistake (a missing key, conflicting endpoint options) instead of throwing synchronously, so a misconfiguration cannot take a page down.
- Each permission is queried once per page and read live, which stops Chromium retaining two `PermissionStatus` objects per identification.
- The README documents first-party proxies (`endpoints`), Content Security Policy and `retryAfterMs`.
- `IdentifyResult.reason` is deprecated and `undefined`: a browser is no longer told why a submission went unscored. Your backend reads `reason` on the server-side event read, by `requestId`.
- Uses @fingerly/core 0.1.1.

## 0.1.0

- First public release.
