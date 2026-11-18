# Hardened browsers

What Brave, Tor, Firefox `resistFingerprinting`, and Safari Private Browsing
actually do to the signals this SDK collects, and how the `0.4.0` (`v: 3`)
single-pass pipeline handles them without user prompts, shared-ID collisions,
or false-positive risk scores.

The client-side collectors live in `@fingerly/web-js` (`src/sources/runtime.ts`,
`shields.ts`, `render.ts`, `durability.ts`) and `@fingerly/core`
(`src/scheduler.ts`), while the authoritative identity and risk gates live on
the server (`server/domain/identity/identity.go`, `shields.go`, and
`server/domain/risk/browser_detectors.go`). This file is the measurement record
behind them: the numbers, where they came from, and the dead ends not to repeat.

## Why this is not the same problem as bot detection

A bot hides. A hardened browser *substitutes* — it returns a plausible, stable,
completely fabricated or cohort-masked value, and nothing about the value
alone says so. That is a worse failure mode than a missing signal, because a
missing signal makes a detector abstain whereas a substituted or uniform value
either splits one returning visitor across sessions or merges strangers onto one
shared `visitorId`.

Three rules follow in `v: 3`:

1. **Never trigger a browser permission prompt or Tor canvas doorhanger
   (Rule #1).** On Gecko engines, Stage 1 (`prerequisite`) runs a bounded
   `2.5ms–3.0ms` single-tick `performance.now()` timer-clamping probe (`0.0ms`
   overhead on WebKit and Blink) before Stage 2 (`<= 350ms` single-pass
   collection) starts. Whenever Gecko clamps timer resolution (`delta == 0`
   within `3.0ms` or `delta >= 1.5ms`), **both** `shields` and `canvas` skip
   every pixel readback (`getImageData`, `toDataURL`, `toBlob`, `convertToBlob`,
   `readPixels`) and emit `status: "blocked", reason: "rfp-canvas-prompt-avoided"`.
   When unlocked, `shields` and `canvas` share a single offscreen `<canvas>`
   render and hash raw `Uint8ClampedArray` RGBA pixels in `< 1.5ms`.
2. **Verify privacy-browser claims behaviorally before exempting rules.** An
   anti-detect bot can forge `shields: { brave: true }` in JSON, so the server
   verifies Brave farbling behaviorally (Chromium engine consistency + Brave's
   unconditional `2147483648` `storage.estimate().quota` / `canvas_noise`
   signature), WebKit consistency on Safari Private Browsing, and Gecko RFP
   consistency on Tor/Firefox before dropping farbled components or exempting
   `fingerprint_suppressed` (`+16`).
3. **Return Option B (`visitorId: ""`) instead of colliding strangers.** When
   correlated cohort masking leaves fewer than `6` independent Tier-A hard
   components (`identifiable: false`), the server declines both `ExactKey` and
   fuzzy candidate matching, skips PostgreSQL `Visitors.Mint()` (zero database
   row growth), suppresses `fingerprint_suppressed` on verified privacy
   browsers, and returns `identifiable: false`, `visitorId: ""`,
   `visitorIsNew: false`, `visitorConfidence: 0`. Running Brave, Tor, or Safari
   Private Browsing is never scored as tampering.

## Brave

Measured on Brave 152 (Chromium 152), macOS, M1 Pro, 16GB. Ordinary and private
windows on the same machine, minutes apart, same origin.

| probe | ordinary | private | verdict |
|---|---|---|---|
| `storage.estimate().quota` | `2147483648` | `2147483648` | **pinned constant** |
| `webkitTemporaryStorage` quota | `10737418240` | `3221225472` | **honest** |
| `webkitPersistentStorage` quota | `10737418240` | `3221225472` | honest, no extra information |
| `navigator.deviceMemory` | 16 | 4, then 16 on a rerun | **farbled per session** |
| `navigator.hardwareConcurrency` | 10 | 8, then 4 on a rerun | farbled per session |
| `navigator.plugins.length` | 7 | 7 | **padded** (spec allows 5 or 0) |
| `navigator.mimeTypes.length` | 2 | 2 | untouched |
| `navigator.connection` | absent | absent | removed |
| `navigator.brave.isBrave()` | `true` | `true` | volunteered (`brave_claimed`) |
| UA-CH brands | includes `Brave` | includes `Brave` | volunteered |
| user-agent string | Chrome's, byte for byte | same | no tell |
| canvas, audio, text metrics | stable within the page | stable, different values | farbled per session+site (`canvas_noise`) |
| WebGL unmasked renderer | real (`Apple M1 Pro`) | real (or masked at aggressive shields) | untouched at default shields |

### Behavioral Brave verification & the quota constant

`brave-core`, `chromium_src/third_party/blink/renderer/bindings/modules/v8/v8_storage_estimate.h`:

```cpp
void setQuota(uint64_t quota) {
  quota = 2147483648;
  StorageEstimate_ChromiumImpl::setQuota(quota);
}
```

Unconditional. Not gated on the shields level, so it is present even when a
visitor lowers fingerprint protection for a site (landed in brave-browser#11543
/ brave-core#6622 and rewritten in brave-core#22320). Because it patches only
the `StorageEstimate` binding, `webkitTemporaryStorage.queryUsageAndQuota`
(`StorageSignal.legacy_quota`) still reports the underlying pool.

On the server (`server/domain/risk/browser_detectors.go` and
`server/domain/identity/shields.go`), a report is treated as verified Brave
farbling only when observed Blink/V8 engine behavior agrees with behavioral
Brave indicators (such as the pinned `2147483648` quota, `canvas_noise`, or
padded plugin invariants alongside `brave` / `brave_claimed`), preventing a
spoofed JSON payload from claiming `brave: true` to bypass `fingerprint_suppressed`
or component checks.

### The device-memory trap

The tempting rule is "Chromium caps `deviceMemory` at 8, Brave draws from
{2, 4, 8, 16, 32}, so anything above 8 is farbling". **It is wrong.**

Chromium's `ApproximatedDeviceMemory::CalculateAndSetApproximatedDeviceMemory`
clamps to `[2, 32]` on desktop and only to `[1, 8]` on Android. An ordinary
desktop Chrome on a 16GB machine reports 16. Brave's replacement set is
deliberately identical to desktop Chromium's legal set, so once behavioral
Brave farbling is detected, detectors never divide quota by `deviceMemory`.

### What broke previously

`detect/incognito` previously computed `quota / (deviceMemory * GiB)` against a
0.3 ceiling. On Brave that evaluated `2 / 16 = 0.125`, falsely flagging
ordinary Brave windows as private (`chromium-storage-quota-ratio-capped`).
Instead, Brave private windows are detected via `legacy_quota - usage < 10 GiB`
(`chromium-quota-below-static-pool`), gated on the modern quota equalling
Brave's `2147483648` constant so small-disk stock Chromium devices are
untouched.

### Dead ends specific to Brave

- Canvas/audio double-render — Brave's farbling is deterministic per session and
  per eTLD+1, so two renders inside one page agree and `unstable` stays false.
  Double-render catches per-read noise, whereas Brave canvas farbling is caught
  via the known-pixel checkerboard canary (`shields.canvas_noise`).
- `navigator.deviceMemory` and `hardwareConcurrency` — farbled into the legal
  range.
- The user-agent string — byte-identical to Chrome's.

## Safari 17+ Private Browsing & correlated-mask grouping

Modern WebKit (Safari 17+ Private Browsing and Advanced Fingerprinting
Protection) combines uniform hardware/GPU masking (`"Apple GPU"`, clamped
screen/hardware traits) with deterministic per-session canvas/WebGL noise
(`canvas_noise == true`).

If the identity engine counted `canvas.geometry`, `canvas.text`,
`webgl.vendor`, `webgl.renderer`, `webgl.params`, and `webgl.precision` as six
independent Tier-A components on a masked session, two bad outcomes would occur:

1. Uniformly masked attributes across identical iPhone or Mac models would meet
   the `MinimumHardComponents = 6` bar and **collide strangers onto a single
   shared `visitorId`**.
2. Session-keyed canvas hashes would miss on every new private tab and bloat
   PostgreSQL `visitor_identities` with orphan rows.

In `v: 3`, `Vector.Identifiable()` (`server/domain/identity/identity.go`) groups
the entire 6-component `renderingFamily` (`canvas.geometry`, `canvas.text`,
`webgl.vendor`, `webgl.renderer`, `webgl.params`, `webgl.precision`) as **at
most 1 correlated family** whenever `CorrelatedMask` is set (`canvas_noise == true`
or generic cohort GPU masking). Combined with masked hardware fields, Safari
Private Browsing (and aggressive Brave / Tor RFP) falls below
`MinimumHardComponents = 6` (`identifiable: false`):

- The server skips `ExactKey` and fuzzy candidate lookup, skips
  `Visitors.Mint()` (zero PostgreSQL writes), and returns **Option B**:
  `identifiable: false`, `visitorId: ""`, `visitorIsNew: false`,
  `visitorConfidence: 0`.
- Because WebKit engine behavior (`engine`, `math`, `errors`, CSS `@supports`)
  is consistent and untampered, `Identifier` exempts `fingerprint_suppressed`
  (`+16`), leaving only `incognito` (`+4`) rather than a false `"medium"` risk
  score.

## Chromium `>= 152` & opt-in `incognitoDetection: 'extended'`

In Chromium 152+, `QuotaManagerImpl::CalculateReportedQuota` enables
`kIncognitoStaticStorageQuota` by default, reporting `usage + 10 GiB`
(`10737418240` at zero usage) in both regular and incognito windows. Both
`isStaticChromiumQuota` and a tightened `0.25` legacy ratio ceiling prevent
inverted false positives on nearly full disks.

### Why `storage_durability` is opt-in (`incognitoDetection: 'extended'`) in `0.4.0`

Chromium's incognito IndexedDB store runs on `leveldb_chrome::NewMemEnv`
(in-memory), where `durability: "strict"` skips real disk `fsync`s while
ordinary profiles pay disk `fsync` latency:

| window | median ratio | relaxed / strict block |
|---|---|---|
| Chrome 152 ordinary | **3.86** | 3ms / 11ms |
| Chrome 152 incognito | **1.06** | 2ms / 2ms |
| Brave 152 ordinary | **3.17** | 3ms / 10ms |
| Brave 152 private | **1.04** | 2ms / 2ms |

However, running sequential `strict` IndexedDB commits on every default
`identify()` call forces dozens of OS `fsync` syscalls and megabytes of SSD
writes onto every ordinary login and checkout for a signal weighted `4` out of
`30`—and Chromium's `IdbSqliteBackingStore` rollout is progressively phasing out
the LevelDB differential.

In `@fingerly/core` and `@fingerly/web-js` `0.4.0`:

- **Default (`incognitoDetection: 'standard'`)**: `storage_durability` does
  **not** run, keeping single-pass Web collection fast (`< 80ms` typical,
  `<= 350ms` ceiling) with zero IndexedDB disk flushes. Safari and Firefox
  private windows are still caught via zero-disk OPFS probes (`1.4` and `1.3`
  evidence), and Brave private windows via `legacy_quota`.
- **Opt-in (`incognitoDetection: 'extended'`)**: Callers who explicitly pass
  `identify({ incognitoDetection: 'extended' })` or
  `collect({ incognitoDetection: 'extended' })` enable `storage_durability` on
  Chromium `>= 152`, capped at `<= 4` relaxed/strict pairs × `3` rounds inside a
  `<= 60ms` ceiling, requiring `honored === true` and sufficient rounds before
  scoring.

### Dead ends for a replacement Chromium tell

All measured identical in Chrome 152 normal and incognito (or rejected by
Rule #1):

- **Encrypted Media (`requestMediaKeySystemAccess`) — banned under Rule #1.**
  Throws `NotSupportedError` in Chrome and triggers a user-visible **Widevine
  install prompt** in Brave; banned in `tests/no-permission-prompts.test.ts`.
- `navigator.storage.persist()` — prompts on Firefox; banned (read-only
  `persisted()` does not discriminate).
- `usageDetails` after a 4MB write — identical breakdown in both modes.
- `Notification.permission` vs `permissions.query({name:'notifications'})` —
  both `default`/`prompt` in regular and incognito windows.
- `webkitTemporaryStorage`, `webkitPersistentStorage`,
  `webkitRequestFileSystem`, `navigator.storage.getDirectory()`,
  `performance.memory.jsHeapSizeLimit`, `indexedDB.databases()`,
  `navigator.storageBuckets`, `caches`, service workers — identical.

## Identity churn & dual coarse buckets (`v: 3`)

Brave reseeds farbling per session and per eTLD+1 across `hardwareConcurrency`,
`deviceMemory`, canvas, and audio:

| field | four windows |
|---|---|
| `hardware_concurrency` | 10, 8, 2, 5 |
| `device_memory` | 16, 4, 4, 4 |
| canvas (RGBA digest) | varies per session |
| audio buffer sum | 172.52, 172.54, 172.60, 172.56 |

Two `v: 3` server mechanisms prevent both identity splitting and single-field
bucket evasion (`server/domain/identity/`):

1. **Component-level farbling strip & Brave invariant recovery (`shields.go`, `brave_invariant.go`)**:
   On behaviorally verified Standard Brave reports (`BALANCED` mode), raw farbled
   components (`canvas.geometry`, `canvas.text`, `audio.value`, `hardware.cores`,
   `hardware.memory`) are stripped while recovering three unfarbled device
   measurements into the Brave invariant profile (`brave_invariant.go`):
   - **High-bit 2D Canvas (`canvas.geometry_high`, `canvas.text_high`)**: Masks
     out bit 0 (`byte & 0xfe`) on every RGBA byte, exactly inverting
     `BraveSessionCache::PerturbPixelsInternal`'s 1-bit LSB XOR, and renders text
     strictly with generic CSS font families (`serif`, `sans-serif`, `monospace`)
     exempt from Brave's session font farbling (`FamilyIsGeneric()`).
   - **Offscreen WebGL 1 Scene Pixels (`webgl.render_hash`)**: Renders a shaded
     64×64 WebGL 1 scene and hashes `readPixels` output, which Standard Brave
     leaves untouched even when `UNMASKED_RENDERER_WEBGL` is masked.
   - **Scale-Invariant Audio Ratios (`audio.crest_ratio`, `shape_ratio`, `decay_ratio`)**:
     Divides `OfflineAudioContext` waveform statistics so Brave's per-session
     constant `fudge_factor` (`[0.999, 1.0)`) cancels out algebraically.
   - **Desktop Screen Quantization Tolerance**: Accounts for
     `ChromeClientImpl::BraveGetScreenInfos` snapping `screen.width`/`height` to
     7 desktop size buckets based on farbled `outerWidth`/`outerHeight` while
     preserving display DPR and colour depth across resized or private windows.
   - **Strict Brave (`MAXIMUM`, `BraveShowStrictFingerprintingMode`)**: When
     Brave's flag-gated strict mode replaces audio with non-negative LFSR noise
     (`negative_samples == 0`), blocks WebGL shaders (`shader_blocked: true`),
     zeroes `measureText` (`text_metrics_width == 0`), replaces plugins with 2
     synthetic entries, empties voices, and clamps `navigator.languages` to
     `["en-US", "en"]`, identity is withheld (`identifiable: false`,
     `visitorId: ""`) and the `identity_obfuscated` risk signal (`weight: 16`)
     is emitted instead.
2. **Dual coarse buckets (`00046_v3_identity_dual_buckets.sql`)**: Historically,
   including `hardware.cores` in a single candidate bucket caused Brave's
   farbled core count (or an anti-detect spoofer editing `hardwareConcurrency`)
   to miss candidate lookup completely. `visitor_identities` and
   `demo_visitor_identities` now index **both** `BucketGPU` (`platform`,
   `webgl.vendor`, `webgl.renderer`) and `BucketComputeScreen` (`platform`,
   `screen.resolution`, `hardware.cores`, `timezone`), querying
   `bucket_key = $2 OR bucket_key_alt = $3` (`LIMIT 64`) under the 17-component
   cross-engine `UniversalWeight()` floor (`>= 18` and `>= 0.70`).

## Reproducing

`sdks/client/web/web-js/demo/shields.html`, served by the `web-js` demo server:

```sh
pnpm --filter @fingerly/web-js demo   # http://localhost:4173/demo/shields.html
```

Run it in an ordinary window and a private window in each browser and diff the
raw browser readings before inspecting SDK or server rules.
