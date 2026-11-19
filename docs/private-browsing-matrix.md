# Private-browsing validation matrix

Manual runs and `0.3.0` (`v: 3`) single-pass contract invariants are recorded
here without IP addresses, profile names, or other visitor-specific values.
Quota and usage are diagnostic observations, not identity material.

## `v: 3` single-pass collection & Option B summary

Across all browser engines in `@fingerly/core` and `@fingerly/web-js` `0.3.0`:

- **Single-pass `<= 350ms` budget (`1-RTT`)**: Stage 1 (`prerequisite`) runs
  `engine` detection plus—on Gecko only—the bounded `<= 3ms` (`2.5ms–3.0ms`)
  single-tick `performance.now()` RFP timer probe (`0.0ms` overhead on WebKit
  and Blink). Stage 2 (`collect`) runs all active browser collectors
  concurrently within `350ms`, letting the identity-critical sources (audio,
  voices, fonts, codecs and the others a device is recognised by) run until
  they answer on a cold browser under the default budget, up to `2.5s` from
  the start of the run (retiring `deferred` and `/api/v1/ingest/supplement`).
- **Option B unidentifiable output (`visitorId: ""`)**: Whenever correlated
  cohort masking or RFP blocking leaves fewer than `6` independent Tier-A hard
  components (`identifiable: false`—such as Safari 17+ Private Browsing,
  aggressive Brave Shields, or Tor Browser / Firefox RFP), the server skips
  `ExactKey` and fuzzy candidate matching, writes **zero** PostgreSQL
  `visitor_identities` rows, returns `identifiable: false`, `visitorId: ""`,
  `visitorIsNew: false`, `visitorConfidence: 0`, and **exempts
  `fingerprint_suppressed` (`+16`)** when engine consistency checks confirm a
  genuine privacy-hardened browser rather than a tampered bot.

## Firefox (`engine === 'gecko'`)

| Window | Tracking protection / RFP | `incognito` verdict | OPFS | Stage 1 RFP guard (`<= 3ms`) | `shields` & `canvas` | Identity output |
| --- | --- | --- | --- | --- | --- | --- |
| Normal | Standard (`1ms` timer) | `false` / silent | `ok` | unlocked (`0 < delta <= 1.2ms`) | raw-RGBA `ok` | `identifiable: true`, stable `visitorId` |
| Private | Standard (`1ms` timer) | `true` / medium | `refused` | unlocked (`0 < delta <= 1.2ms`) | raw-RGBA `ok` | `identifiable: true` (or `""` if masked) |
| Normal | Strict (`1ms` timer) | `false` / silent | `ok` | unlocked (`0 < delta <= 1.2ms`) | raw-RGBA `ok` | `identifiable: true` (or `""` if masked) |
| Private | Strict / `resistFingerprinting` | `true` / medium | `refused` | clamped (`delta == 0` or `>= 1.5ms` under RFP) | `blocked` (`rfp-canvas-prompt-avoided` under RFP) | Option B (`visitorId: ""`, `fingerprint_suppressed` exempted when RFP active) |

All runs report Gecko (`SpiderMonkey`, `-moz-appearance`, FDLIBM math)
consistently. `firefox-private-origin-filesystem-refused` separates normal and
private windows across Standard and Strict tracking protection without treating
Strict tracking protection in a normal window as private browsing. Zero storage
usage is retained only as a diagnostic observation because a fresh normal
profile also reports zero usage; service workers remain available in modern
Firefox private windows (`>= 138`) and serve only as a legacy fallback.

## Safari 17+ / 26 on macOS & iOS (`engine === 'webkit'`)

| Window | `incognito` verdict | OPFS | Correlated mask (`renderingFamily`) | `fingerprint_suppressed` | Identity output (`v: 3` Option B) |
| --- | --- | --- | --- | --- | --- |
| Normal (macOS 26.5 / iOS 26.0) | `false` / silent | `ok` (`82.5 GB` / `41.2 GB` quota) | `false` | silent | `identifiable: true`, stable `visitorId` |
| Private (Safari 17+ / 26) | `true` / medium (`+4`) | `transient` (`1,048,576,000` quota) | `true` (`canvas_noise` + `"Apple GPU"` collapsed to `1` family) | **exempted** (engine-consistent WebKit) | `identifiable: false`, `visitorId: ""`, `visitorIsNew: false`, `visitorConfidence: 0`, `0` DB rows |

Both macOS and iOS Safari claim and observe WebKit (`JavaScriptCore`,
`-webkit-touch-callout`) consistently within a single pass. Private windows
reject OPFS with `transient` (`safari-private-origin-filesystem-refused`).

Because Safari 17+ Private Browsing applies uniform hardware/GPU cohort masking
alongside per-session canvas noise, `Vector.Identifiable()` groups the 6
rendering/WebGL traits (`canvas.geometry`, `canvas.text`, `webgl.vendor`,
`webgl.renderer`, `webgl.params`, `webgl.precision`) into **1** correlated
family. That prevents two strangers on identical iPhone or Mac models from
colliding onto one shared `visitorId`, prevents per-tab canvas noise from
bloating `visitor_identities`, and suppresses `fingerprint_suppressed` (`+16`)
because WebKit engine grammar is consistent.

Mobile Safari inside the iOS Simulator intentionally leaves web
`virtual_machine` silent because Simulator Mobile Safari exposes an
iPhone-shaped WebKit surface (`Apple GPU`, DPR 3, coarse pointer); the native
iOS `0.3.0` SDK detects `#if targetEnvironment(simulator)` directly at weight
`16`.

## Chromium `>= 152` & Brave (`engine === 'blink'`)

| Browser & mode | `incognitoDetection` option | `incognito` verdict | Discriminator | Behavioral Brave check & identity output |
| --- | --- | --- | --- | --- |
| Chrome 152+ Normal | `'standard'` (default) | `false` / silent | Static `10 GiB + usage` quota (`isStaticChromiumQuota`); `storage_durability` skipped | `identifiable: true`, stable `visitorId` |
| Chrome 152+ Incognito | `'standard'` (default) | `false` / silent | Static `10 GiB + usage` quota flattened by `kIncognitoStaticStorageQuota`; zero `fsync` overhead | `identifiable: true`, stable `visitorId` |
| Chrome 152+ Incognito | `'extended'` (opt-in) | `true` / medium (`+4`) | `storage_durability` strict/relaxed commit ratio `< 1.30` (`<= 4` pairs × `3` rounds, `<= 60ms`, `honored === true`) | `identifiable: true`, stable `visitorId` |
| Brave 152+ Normal (Standard Shields) | `'standard'` or `'extended'` | `false` / silent | Modern quota pinned at `2147483648`; `legacy_quota` `10 GiB` | Verified via Blink consistency + `2147483648` quota / `canvas_noise`; farbled fields stripped, recovered high-bit 2D canvas + WebGL scene pixels + scale-invariant audio ratios match across normal, private, resized, and restarted sessions (`identifiable: true`, stable `visitorId`) |
| Brave 152+ Private (Standard Shields) | `'standard'` or `'extended'` | `true` / medium (`high` with `'extended'`) | `legacy_quota - usage < 10 GiB` (`chromium-quota-below-static-pool`), corroborated by `storage_durability` when `'extended'` is set | Same recovered Brave invariant profile resolves the same `visitorId` as Normal window (`identifiable: true`) without IP bridging |
| Brave 152+ Strict (`brave://flags` `BraveShowStrictFingerprintingMode`) | `'standard'` or `'extended'` | `false` (normal) / `true` (private) | Blocked WebGL shader link, zeroed `TextMetrics.width`, negative `OfflineAudioContext` samples, empty `speechSynthesis` + `["en-US","en"]` | Option B (`identifiable: false`, `visitorId: ""`, `0` DB rows) + `identity_obfuscated` (`+16`), `fingerprint_suppressed` exempted |

## Tor Browser (Firefox 140 ESR) on macOS (`engine === 'gecko'`)

| Security level | `tor` verdict | `incognito` verdict | Clock clamp | Stage 1 guard (`<= 3ms`) | `shields` & `canvas` | Doorhanger prompt | Identity output (`v: 3` Option B) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Standard | `true` / medium or high | `true` / high | `16.667ms` or `100ms` | tripped (`delta == 0` within `3.0ms` or `>= 1.5ms`) | both `blocked` (`rfp-canvas-prompt-avoided`) | **none** (`0` pixel readbacks) | `identifiable: false`, `visitorId: ""`, `visitorIsNew: false`, `visitorConfidence: 0`, `fingerprint_suppressed` exempted |
| Safest | `true` / high | `true` / high | `100ms` | tripped | both `blocked` (`rfp-canvas-prompt-avoided`) | **none** (`0` pixel readbacks) | `identifiable: false`, `visitorId: ""`, `visitorIsNew: false`, `visitorConfidence: 0`, `fingerprint_suppressed` exempted |

Both security levels letterbox the viewport and disable service-worker
registration. In `0.3.0`, Stage 1 (`runtime.ts`) gates **both** `shieldsSource`
and `canvasSource` behind the Gecko-only `2.5ms–3.0ms` single-tick
`performance.now()` probe before Stage 2 starts, recognizing both `16.67ms` and
`100ms` timer clamps (verified in CI by `tests/no-permission-prompts.test.ts`
spying on `getImageData`, `toDataURL`, `toBlob`, `convertToBlob`, and
`readPixels`). Neither collector touches canvas readback APIs under clamping,
guaranteeing zero Tor Browser or Firefox RFP permission doorhangers (**Rule #1**).

## Still requiring physical/manual coverage

- Physical-iPhone confirmation across upcoming iOS point releases
- A second independent zero-prompt Firefox private-browsing tell before Mozilla
  enables OPFS in private windows (Bug 1975760)
