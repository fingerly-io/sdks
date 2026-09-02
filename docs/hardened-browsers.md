# Hardened browsers

What Brave, Tor and the rest actually do to the signals this SDK collects, and
which of our rules that breaks.

The rules themselves live in `@badele/core`'s `detect/shields.ts` and are
commented there. This file is the measurement record behind them: the numbers,
where they came from, and the ones that turned out to be dead ends, so that the
next person to have a good idea about `navigator.deviceMemory` can check here
before spending an afternoon on it.

## Why this is not the same problem as bot detection

A bot hides. A hardened browser *substitutes* - it returns a plausible, stable,
completely fabricated value, and nothing about the value says so. That is a
worse failure mode for us than a missing signal, because a missing signal makes
a detector abstain and a substituted one makes it answer confidently.

The rule that follows from it: **a detector must never reason from a value the
browser is known to fabricate, however well that value matches.** Gating is not
a nicety here, it is the whole defence.

And the corollary, which matters commercially: none of this is evidence about
the visitor. Running Brave means running Brave. `Verdicts.shields` exists to be
read by our own code, not to be shown to a customer as a risk factor.

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
| `navigator.brave.isBrave()` | `true` | `true` | volunteered |
| UA-CH brands | includes `Brave` | includes `Brave` | volunteered |
| user-agent string | Chrome's, byte for byte | same | no tell |
| canvas, audio, text metrics | stable within the page | stable, different values | farbled per session+site |
| WebGL unmasked renderer | real (`Apple M1 Pro`) | real | untouched at default shields |
| `speechSynthesis.getVoices()` | 0 | 0 | suppressed |

### The quota constant

`brave-core`, `chromium_src/third_party/blink/renderer/bindings/modules/v8/v8_storage_estimate.h`:

```cpp
void setQuota(uint64_t quota) {
  quota = 2147483648;
  StorageEstimate_ChromiumImpl::setQuota(quota);
}
```

Unconditional. Not gated on the shields level, so it is there even for a
visitor who turned fingerprint protection off for the site. Landed as
brave-browser#11543 / brave-core#6622 in 2020 for the express purpose of
breaking private-window detection, and rewritten into its current form in
brave-core#22320.

It patches the `StorageEstimate` binding, which is why
`webkitTemporaryStorage.queryUsageAndQuota` - a different, deprecated path to
the same quota manager - still reports the truth. That is the reading
`StorageSignal.legacy_quota` carries, and it is the only reason Chromium
private-window detection works on Brave at all.

Expect it to be closed once anyone notices. It is deprecated in Chromium and
scheduled for removal regardless, so the field is written as a second opinion:
when it goes, it goes absent, and the detector falls back rather than reading a
missing value as a small one.

### The device-memory trap

The tempting rule is "Chromium caps `deviceMemory` at 8, Brave draws from
{2, 4, 8, 16, 32}, so anything above 8 is farbling". **It is wrong**, and it was
one commit from shipping here.

Chromium's `ApproximatedDeviceMemory::CalculateAndSetApproximatedDeviceMemory`
clamps to `[2, 32]` on desktop and only to `[1, 8]` on Android. The 8 cap is the
*spec's* recommendation and Android's limit, not desktop Chrome's behaviour. An
ordinary desktop Chrome on a 16GB machine reports 16, and the rule above would
have fired on every one of them - replacing the false positive we were fixing
with a larger one.

Brave's replacement set is exactly the set of values a desktop Chromium can
legitimately report. That is deliberate. There is no arithmetic that recovers
the true value, and the farbled 16 and the honest 16 are the same number, so
the only correct handling is to stop dividing by the field once anything else
says the browser farbles.

### What broke, exactly

`detect/incognito` computed `quota / (deviceMemory * GiB)` and compared against
a 0.3 ceiling. On Brave that is `2 / 16 = 0.125` - a constant over a die roll -
so **every Brave visitor on the web was reported to be browsing privately**,
from an ordinary window, at medium confidence, citing
`chromium-storage-quota-ratio-capped`. Both inputs were fabricated and the
output looked like a measurement.

### Dead ends specific to Brave

- Canvas/audio double-render - Brave's farbling is deterministic per session and
  per site, so two renders inside one page agree and `unstable` stays false.
  That check catches Tor and per-read noising, not Brave.
- `navigator.deviceMemory` and `hardwareConcurrency` - farbled, and farbled into
  the legal range. See the trap above.
- The user-agent string - byte-identical to Chrome's. Only UA-CH names Brave.

Everything Chromium closed for both browsers is listed under Chromium below.

### Brave private windows

Detected, but not by anything Brave leaves in `navigator.storage.estimate()`.

Brave took Chromium's *static* quota for ordinary windows - its legacy reading
is the 10 GiB constant - without taking `kIncognitoStaticStorageQuota`, which
would have pinned the private one too. So a Brave private window still reports
the memory-derived incognito pool: 3 GiB against the ordinary window's 10.

The rule is `legacy_quota - usage < 10 GiB`, which needs no device memory at all
and is therefore immune to the farbling that killed the ratio test. It fires as
`chromium-quota-below-static-pool`.

The bound on it: a device with less than 10 GiB of *total* disk gets a
disk-derived quota in an ordinary window too, and would be read as private. That
is not a desktop configuration, and the rule is gated on the modern reading
being Brave's pinned constant, so it cannot reach a stock Chromium.

## Chromium, which closed the same door in 152

Not a hardened browser, but the same problem and a much larger blast radius.

`QuotaManagerImpl::CalculateReportedQuota`:

```cpp
// The flag kIncognitoStaticStorageQuota fixes the return value in incognito
// to 10 GiB + usage, as in regular mode.
if ((clamped_total_space_bytes >= 10 * kGBytes) || enforce_static_quota_for_incognito) {
  return clamped_usage_bytes + 10 * QuotaManagerImpl::kGBytes;
}
// ...otherwise disk space rounded up to the nearest 1 GiB.
```

`kIncognitoStaticStorageQuota` is `FEATURE_ENABLED_BY_DEFAULT`, and its comment
in `quota_features.cc` states the intent outright: *"Incognito mode will always
report a maximal quota value to avoid fingerprinting and incognito detection."*

Measured on Chrome 152, same machine, both windows: `estimate().quota`,
`webkitTemporaryStorage` and `webkitPersistentStorage` all returned
`10737418240` - `usage(0) + 10 GiB` - in **both**. Chrome 151 still gave 3 GiB
against 10.

Two consequences, and the second is the one that mattered:

1. **Quota-based incognito detection on current Chrome is dead.** Not degraded,
   not farbled - the two windows emit identical quota readings.
2. **Below the constant the meaning inverts.** Only an ordinary window is still
   allowed a disk-derived figure, so on a current build a small quota is
   evidence *against* a private window. The old rule read it as the opposite and
   fired on any visitor whose disk was nearly full.

Both are handled by comparing against the constant before doing anything else,
which is what `isStaticChromiumQuota` is for. The ratio ceiling also came down
from 0.3 to 0.25, since Chromium sizes the pool at 0.15-0.2 of physical memory
(`kIncognitoQuotaRatioLowerBound` / `UpperBound`) and 0.3 reached far enough up
to catch the full-disk case at 0.29.

### What replaced it: durability, not quota

Every *value* Chromium reports about storage has now been flattened. What has
not been flattened is the *cost*, because flattening that would mean making an
incognito profile actually write to disk.

`CreateLevelDBState` sees an empty path in an incognito profile and builds the
IndexedDB store on `leveldb_chrome::NewMemEnv` - an in-memory environment. The
fsync that `BackingStore::ShouldSyncOnCommit` issues for a
`durability: "strict"` commit therefore lands in memory and costs nothing. On
disk, that fsync is by far the most expensive part of a small transaction.

So: run the same fifteen 16KB single-put commits twice, once at
`durability: "relaxed"` and once at `"strict"`, and take the ratio.

Measured on one M1 Pro, four windows, same origin, minutes apart:

| window | median ratio | relaxed / strict block |
|---|---|---|
| Chrome 152 ordinary | **3.86** | 3ms / 11ms |
| Chrome 152 incognito | **1.06** | 2ms / 2ms |
| Brave 152 ordinary | **3.17** | 3ms / 10ms |
| Brave 152 private | **1.04** | 2ms / 2ms |

On disk 3.06-3.86, in memory 0.96-1.06, with the threshold at 1.30 sitting well
clear of both. The individual rounds spread wider than the medians - one
in-memory round came in at 1.31 - which is the entire reason the median is taken
rather than a single reading.

The **ratio** is the point. A duration measures the machine, and a threshold on
one is a threshold on how fast the visitor's phone is - which is how the
previous generation of this idea came to fire on cheap Android hardware. The
ratio divides the hardware out: a slow device and a fast one disagree about
everything here except that syncing costs more than not syncing.

The technique and the constants (16KB payload, 15 writes per block, threshold
1.30) are Joe Rutkowski's, from
[detectIncognito](https://github.com/Joe12387/detectIncognito) v1.8, calibrated
there against eighteen real Android devices.

The round count is ours and is lower: nine, not fifteen. The four windows above
were sampled at both, and the two agree about every one of them with the whole
of the gap to spare - 3.778/3.86, 1.000/1.056, 3.062/3.17, 0.962/1.043. The six
extra rounds bought no accuracy, and they were not free: a round costs almost
nothing in memory and about 15ms on disk, so they were mostly spent on visitors
who are *not* browsing privately. Collection for an ordinary Chrome window went
from 248ms to 154ms; an incognito one was 81ms either way. `SOURCE.storage_durability` reports
the ratio rather than his boolean, so the threshold can be re-cut server-side
over stored reports instead of waiting for every customer to ship a new SDK.

Three guards, because this is a timing measurement and timing measurements lie:

- `honored` - an engine that ignores the `durability` hint runs both halves
  identically, which would read as in-memory on every machine on earth.
  Checked before anything is timed.
- `rounds` - a median over two readings is not a median. The detector requires
  five. Reports with fewer were taken on machines too loaded to measure, which
  is exactly where answering anyway invents a false positive.
- Weight 1.4 - decisive alone, but short of `high`. `high` is reserved for the
  case where the quota agrees with it, which is what Brave private does.

**The premise to re-check when this breaks:** Chromium is migrating IndexedDB
from LevelDB to SQLite (`IdbSqliteBackingStore`, staged behind
`GetSqliteRolloutStage`). A SQLite backing store may not have the same in-memory
shortcut. If it becomes the default, this source starts reporting ratios near 1
on disk too - and `honored` and `rounds` are on the report so that shows up in
the data rather than as a silent wave of false positives.

### Dead ends for a replacement Chromium tell

### Dead ends for a replacement Chromium tell

All measured identical in Chrome 152 normal and incognito:

- **Encrypted Media (`requestMediaKeySystemAccess`) - do not try this one.**
  It looked like the best candidate on paper: a `persistentState: 'required'`
  licence needs disk an incognito profile does not have. In practice it threw
  `NotSupportedError` in both Chrome windows and, in Brave, raised a **Widevine
  install prompt** at a visitor who had not asked for one. Zero discriminating
  power and the one thing this SDK must never do. `requestMediaKeySystemAccess`
  is now in the banned list in `tests/no-permission-prompts.test.ts`, which also
  covers `demo/` since that is where it slipped through.
- `navigator.storage.persist()` - `false` in every window, and it prompts on
  Firefox. `persisted()` is the read-only form and is safe.
- `usageDetails` after a 4MB write - broke down by backend identically in both.

- `Notification.permission` vs `permissions.query({name:'notifications'})` -
  both `default`/`prompt`. The classic contradiction is closed. (Worth knowing:
  `PermissionsSignal.inconsistent` is read by `detect/automation` at weight 1.1,
  and this is the evidence it is *not* firing on private windows.)
- `webkitTemporaryStorage` and `webkitPersistentStorage` - both the constant.
- `webkitRequestFileSystem`, TEMPORARY and PERSISTENT, 1 byte and 256MB -
  granted in both.
- `navigator.storage.getDirectory()` - resolves in both.
- `performance.memory.jsHeapSizeLimit`, `indexedDB.databases()`,
  `navigator.storageBuckets`, `caches`, service workers - identical.

These are all *values*. That every one of them came back identical is what
pointed at timing: when a browser has flattened everything it reports, what is
left is what it does.

## Identity churn, which is the bigger cost

Brave reseeds its farbling per session and per eTLD+1. So a Brave visitor's
canvas, audio, WebGL, font metrics, plugin names, device memory and core count
are not *wrong* - they are correct today and different tomorrow.

That is worse than wrong. A wrong signal is noise; a signal that is stable
within a session and reseeded between them looks exactly like a genuine
returning visitor right up to the moment it silently splits one person into two
identities, on every visit, forever.

Which components that costs is a component-level question, and the list lives
server-side in `domain/identity/shields.go`, beside the code that uses it.
Measured across four Brave windows on one machine, these move on their own:

| field | four windows |
|---|---|
| `hardware_concurrency` | 10, 8, 2, 5 |
| `device_memory` | 16, 4, 4, 4 |
| canvas (data URL length) | 10018, 10162, 10098, 10094 |
| audio buffer sum | 172.52, 172.54, 172.60, 172.56 |

The audio figure is the one to look at twice. The identity vector rounds it to
four significant figures precisely to absorb scheduler jitter, and Brave's
redraw still crosses the boundary - 172.5 against 172.6 - so the rounding that
saves an ordinary browser does not save this one.

The bucket was the half that hurt most. The candidate bucket included
`hardware.cores`, so a Brave visitor landed in a different bucket on every visit
and was never scored against their own history at all.

**The list is deliberately short, because over-dropping inverts the failure.**
Instead of one person becoming many, many become one, and a wrong identifier is
worse than a missing one because everything downstream trusts it. So
`webgl.vendor` and `webgl.renderer` stay - measured identical in all four
windows, unmasked, and the backbone of the bucket - as do screen, platform and
`audio.sample_rate`. The soft tier is untouched entirely: nothing there reaches
the exact key or the bucket, so a soft component that drifts costs a little
similarity score and cannot split a visitor in two.

There was briefly a `farbledSources()` in the SDK returning *source ids* for
this. It is gone, and the reason is instructive: a source is too coarse a unit.
Dropping the `audio` source takes `sample_rate` with `value`, and `sample_rate`
is one of the few components a Brave visitor has left. Dropping `webgl` takes
the vendor and renderer that the bucket is built on. The list was not merely
imprecise; it pointed the wrong way.

### Still open

`webgl.params` and `webgl.precision` are not dropped, and it is a real question
rather than an oversight. Brave patches `webgl_rendering_context_base.cc`, so
`getParameter` is a farbling surface on paper - but neither hash was captured in
the runs above, and nothing is dropped on the strength of a code path nobody
measured. It is load-bearing: a Brave vector keeps eight hard components, and
those two are a quarter of what is left. If they churn, both must go, which puts
Brave at exactly the minimum with no margin.

`demo/shields.html` reports `identity_inputs` for exactly this: run it, quit the
browser, run it again, and diff that block. Anything that moved is a component
that splits one visitor into two.

## Reproducing

`packages/web-js/demo/shields.html`, served by the web-js demo server:

```sh
pnpm --filter @badele/web-js demo   # http://localhost:4173/demo/shields.html
```

Deliberately imports nothing from the SDK. When a gate is wrong, the first thing
to establish is what the browser actually did, without the layer under suspicion
in the way. Run it in an ordinary window and a private one, in each browser, and
diff the two.
