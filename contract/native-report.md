# Native raw report contract (Android and iOS)

The raw report the Android and iOS SDKs send so that the server can derive every detection. It is the
contract the Android, iOS and server work builds against in parallel.

Rule: a client collects and sends. No client holds a weight, a threshold, a verdict, a confidence or a
fraud conclusion. Everything in section 8 runs on the server and only there.

Android 0.1.0 is published. A change keeps the schema number when it only removes a field, lets a field be absent,
or adds a field: the server reads every source as an object and looks fields up by name, so an unknown field is
ignored and an absent one reads as not known. Anything else needs a new schema number. (Android ADR 0001.)

## 1. Conventions

**Status words.** `unchanged`: same name, type and meaning as today. `new`: did not exist. `renamed`: same
measurement under a new name or type.

**Absent is not false.** A field that could not be read is omitted (`jsonObject` already drops nulls on both
platforms). The server treats absent, null and wrong-typed values as "not known" (`risk/report.go`). Rules that
test `== false` do not fire on absent values. This is about fields inside a source. A source id is never absent from a
real report: see section 8.11.

**Probe errors.** A security source that ran keeps `status: "ok"` when one of its probes threw, was denied or could not
answer; a probe error is not a source failure. The probe's field is left out rather than sent with the clean value it never
measured (no `su_paths: []` for a lookup the sandbox denied), and the probe's short name goes into the source value's
`probe_errors`: a sorted, de-duplicated string array of names matching `[a-z0-9_]`, at most 32 entries, omitted when empty.
The Android SDK sets it on `root`, `emulator`, `instrumentation` and `cloned`; the probe names and the fields each one leaves
out are listed under those sources in section 2. The iOS SDK does not set it: its probes answer inside the sandbox rather
than fail. The server reads `probe_errors` on Android `root`, `emulator`, `instrumentation`, `cloned`, `debugger` and `tls`,
on iOS `jailbreak`, `instrumentation`, `debugger` and `tls`, and in `integrity` (`detectProbeErrors`,
`domain/risk/native_report.go`). It fires the low-weight signal `probe_errors` (weight 2, in the `report_incomplete` group),
reason `probe-errors-<count>-<where>`, low confidence for one place and medium for two or more. Android's `su_paths`,
`su_on_path`, `busybox_paths` and `framework_paths` are denied by the ordinary SELinux policy on most devices, so those four
names alone never fire it. A missing field is never read as clean: a rule that needs a measured empty list
(`rootLooksClean`, section 8.12) treats an absent one as unknown. A `probe_errors` value that is not a list of names counts
as one error.

**Default bounds.** Unless a table says otherwise: strings at most 256 bytes (truncate), integers are 32-bit
signed, doubles are finite. Every array has a cap in its table; a client stops at the cap, it does not fail.

**Envelope.** Shape: `{ schema, budget_ms, elapsed_ms, tiers, digest_salt_id, sources: { id: { status, ms, value?, reason? } }, integrity }`.
`digest_salt_id` (string, 16 lowercase hex characters, or `""`) names the salt the report's name digests were keyed with (section 1.4).
`schema` becomes `2` on both native platforms, because field meanings change. The server reads rules the same way whatever the
schema, but a native report that lacks `schema` or names one below `2` is tampering evidence (8.11): no native SDK ever sent anything
else, so a lower number is a report asking to be read by older rules.
A source is only read when `status == "ok"` (`sourceValue`), except the rules that test `status` directly.

**v3 HTTP envelope.** Over HTTP (`v: 3`), this raw report travels as the `signals` JSON object inside the unified envelope specified in
[v3-envelope.md](./v3-envelope.md). Cryptographic attestation proofs (`android_key_register`, `android_key_assert`, `app_attest_register`,
`app_attest_assert`, `device_token`, and `play_integrity_token`) move to the top-level `attest` (`AttestEnvelope`) field and sign the raw
UTF-8 `signals` wire bytes before JSON decoding; see section 11.

**Every source id is always sent.** The set of keys never depends on how a run went: a source the budget never reached is
`{ status: "timeout", reason: "budget-exhausted", ms: 0 }`, and one that overran its own timeout is `timeout` with the time it took. So a
missing source id, or an `ok` with no object value, is never a slow device. It is evidence (8.11). `tiers` says which tiers ran, and only
the sources of a tier the report claims to have run are required; `fast` is always required.

**Status words** are `ok`, `unsupported`, `blocked`, `timeout` and `error`. Anything else is not a report a client wrote.

**Cohort safety.** `domain/risk/archive_fields.go` builds the velocity cohort from invariant scalar keys of `hardware`,
`system` and `app` (`display` pixel fields are excluded because orientation and split-screen mutate them). Native identity uses
`identity.install_id` on both platforms, supplemented on Android by `identity.ssaid_digest`, a SHA-256 of `ANDROID_ID` keyed by
the app's signing certificate, for reinstall persistence. The server uses it only for a report whose Android key attestation
verified on a locked, verified-boot device with no integrity trigger, keeps it only as a project-scoped key (never the digest,
never archived on event documents) and removes it on visitor erasure and expiry. No other device identifier enters identity.

**Free text.** No names from outside system trees, no other app's name, no raw data directory, no installer
package, no accessibility service name. Where the raw value is a name it travels as a salted `nameDigest` (section 1.4).

### 1.1 hash64

Sixteen lowercase hex characters: xxHash32 of the UTF-8 bytes with seed `0`, then with seed `0x9E3779B1`,
concatenated. Identical to `hash64` in the Android and iOS SDKs. It is not a name digest and is used for exactly three
values: Android `app.signature_digest`, iOS `system.kernel_version` and iOS `images.digest`. Every name digest on both
platforms is a `nameDigest` (section 1.4). Check it against these vectors:

| Input | hash64 |
|---|---|
| empty string | `02cc5d0536b78ae7` |
| `frida` | `f41e85c7a03724b3` |
| `libfrida` | `3a3ce88acc91009c` |
| `gmain` | `ac91c1153b7d631b` |
| `android` | `5a5008ee6d29d181` |
| `debug` | `0b51d535d76e0624` |
| `mobilesubstrate` | `ac87adbefaa23205` |
| `tweakinject` | `a2b7f83fcdf7828b` |
| `charles` | `55c74322113d1f1b` |
| `abcdefghijklmnopqrstuvwxyz` | `63a14d5f235204a9` |

### 1.2 nameHashes: the one name-to-hash expansion

Used for libraries, threads, certificate subjects and signer subjects. Input is one name.

1. Lowercase, locale-independent.
2. Android memory-map names only: strip a leading `memfd:` and a trailing ` (deleted)`.
3. Keep this as `leaf`. Remove one trailing `.so` or `.dylib` to get `stem`.
4. `tokens` = `stem` split on every character outside `[a-z0-9]`, keeping tokens of 3 or more characters that
   are not all digits.
5. Output the set `{ nameDigest(stem) } ∪ { nameDigest(t) for t in tokens }` (section 1.4), on both platforms.
6. iOS image names only: also add `nameDigest(leaf)`, with the extension. Two iOS markers are bound to the extension.

Why tokens and not only the whole name: today's library markers are substrings, and a hash can only match
exactly. `libfrida-gadget-16.5.2.so` has a new whole name every release, but always yields the token `libfrida`.

Examples: `libfrida-gadget-16.5.2.so` gives stem `libfrida-gadget-16.5.2`, tokens `libfrida`, `gadget`.
`memfd:frida-agent-64.so (deleted)` gives stem `frida-agent-64`, tokens `frida`, `agent`.
`libXposed_art.so` gives stem `libxposed_art`, tokens `libxposed`, `art`.

The server holds marker strings in the clear (section 8.13), digests them under the zero salt and each project's salt,
and tests set membership.

### 1.3 Types used below

- `hash64`: one `hash64` (section 1.1).
- `digest128`: one `nameDigest` (section 1.4). `digest128[]`: sorted ascending unless a rule below says otherwise; no
  duplicates.
- `TokenSets`: array of arrays of `digest128`. Each inner array is one `nameHashes` output, capped at 24 and sorted.
- `ImageRef` (iOS): for an image in a system tree (`usr_lib`, `system_library`, `system_applications`,
  `library_apple`, `sim_root`), the leaf file name as reported. For anything else, `nameDigest` of the lowercased
  leaf. Never a path. A system tree is decided by more than the path: an image under `/usr/lib/` or
  `/System/Library/` is a system image only when the dyld shared cache contains it or it is one of the listed
  standalone OS images and its file has a Mach-O header (see `image_trees` in section 3), so a dylib dropped under a
  system prefix is `other` and travels hashed.

### 1.4 nameDigest and the project digest salt

Thirty-two lowercase hex characters: the first 16 bytes of `HMAC-SHA256(salt, UTF-8 name)`, keyed with the project's
32-byte digest salt (`core/Hash.kt` on Android, `Core/NameHashes.swift` on iOS, `domain/risk/native_hash.go` on the server).

- **The salt.** The server generates one random 32-byte salt per project when the project is created; it is never shown in
  the console. It reaches the SDK as `digest_salt`, unpadded `base64url`, in `AttestationChallengeOut`: the cold-start
  `POST /api/v1/attestation/challenge` answer and every `next_attestation` ([v3-envelope.md](./v3-envelope.md) section 1.3).
  The SDK caches it per SDK key in the same container storage as the install record (`noBackupFilesDir` on Android, the
  app's own container on iOS).
- **`digest_salt_id`.** Every report names the salt it used at its top level: the first 8 bytes of `SHA-256(salt)` as 16
  lowercase hex characters.
- **No salt yet.** On the very first call, or when no challenge was offered, the SDK keys the same HMAC with 32 zero bytes
  and sends `digest_salt_id: ""`.
- **Server matching.** The server holds its marker names in the clear and digests them under the zero salt at start-up and
  under each project's salt (cached). A report is matched under the salt its `digest_salt_id` names. An id that does not name
  the project's salt is matched as zero-salt, which a report digested under another salt
  never matches, so it adds nothing.

Android sends as `nameDigest`: `instrumentation.library_hashes` and `thread_hashes`, `app.signer_subject_tokens`,
`tls.chain_subject_tokens`, and `images.digest`, which is one `nameDigest` over the image names joined by `\n`. iOS sends as
`nameDigest`: `instrumentation.library_hashes`, `thread_hashes` and `app_image_hashes`, the hashed `ImageRef` of a
non-system image, and `tls.chain_subject_tokens`. The values that are not name digests keep `hash64` (section 1.1):
Android `app.signature_digest`, iOS `system.kernel_version` and iOS `images.digest`.

Because the key is per project, the same name digests differently in two projects, and a digest cannot be looked up in a
word list without the project's salt. Known-answer vectors, with the salt bytes `0x00` to `0x1f`:

| Input | nameDigest |
|---|---|
| `libfrida-gadget.so` | `72e6904a26d05758813f8b7be4d52471` |
| `com.example.app` | `86aa713c3c4d9e001dbbe3b4818ce84b` |
| `MobileSubstrate` | `15055d9c13f7a864275eb7df9253b8e7` |
| `digest_salt_id` of that salt | `630dcd2966c43366` |

## 2. Android report

Probe lists stay in the client (paths, package names, class names, ports). Lists that interpret a value already
read move to the server.

### identity (fast, essential)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `install_id` | string | UUID, 36 | unchanged |
| `ssaid_digest` | string | 64 lowercase hex, `SHA-256("fingerly:ssaid:v1:" + signer + ":" + android_id)` where `signer` is the lowercase hex SHA-256 of the app's signing certificate (as `app.signature_sha256`) and `android_id` is `Settings.Secure.ANDROID_ID` lowercased; absent when unavailable, a placeholder (empty, non-hex, under 8 or over 64 characters, all zeros, `9774d56d682e549c`), or when the certificate cannot be read. Example: signer `ab` x 32, `android_id` `a1b2c3d4e5f60718` gives `7380b395b7e51d95cbd1c8c592e6c0f9284128d248f430183eff1b2c71cc30e5` | new |
| `launches` | int | >= 1, once per process | unchanged |
| `first_seen_at` | int | epoch seconds | unchanged |
| `install_age_h` | int | may be negative (clock set back) | unchanged |
| `signature_changed` | bool | | unchanged |

### system (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `os_release` | string | | unchanged |
| `sdk_int` | int | | unchanged |
| `codename` | string | | unchanged |
| `incremental` | string | | unchanged |
| `security_patch` | string | absent below API 23 | unchanged |
| `build_id` | string | | unchanged |
| `build_type` | string | | unchanged |
| `build_tags` | string | | unchanged; now the only input for `test_keys` |
| `fingerprint` | string | | unchanged |
| `booted_recently` | bool | under 5 minutes; never the uptime | unchanged |
| `device_provisioned` | bool | | unchanged |

### hardware (fast; in the velocity cohort, no new scalars)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `model`, `manufacturer`, `brand`, `device`, `product`, `board`, `hardware`, `bootloader` | string | | unchanged |
| `abis` | string[] | at most 8, each at most 16 | unchanged; now the only input for x86 |
| `cores` | int | | unchanged |
| `memory_gb` | int | | unchanged |
| `soc_manufacturer`, `soc_model` | string | absent below API 31 | unchanged |
| `cpu_hardware` | string | raw `/proc/cpuinfo` Hardware | unchanged; now the only input for the virtual CPU rule |
| `cpu_implementer`, `cpu_part` | string | | unchanged |

### display (fast)

| Field | Type | Status |
|---|---|---|
| `width`, `height`, `density_dpi`, `x_dpi`, `y_dpi`, `refresh_hz` | int | unchanged |
| `density` | double | unchanged |

### storage (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `free_ratio` | double | 0 to 1, 2 decimals | unchanged |
| `external_emulated` | bool | | unchanged |

### intl (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `timezone` | string | IANA | unchanged |
| `utc_offset_min` | int | | unchanged |
| `dst` | bool | | unchanged |
| `locale` | string | BCP 47 | unchanged |
| `uses_24h` | bool | | unchanged |

### accessibility (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `font_scale`, `animator_scale`, `transition_scale`, `window_scale` | double | | unchanged |
| `screen_off_timeout_s` | int | absent when never sleeps | unchanged |
| `screen_never_sleeps` | bool | | unchanged |
| `any_service_enabled` | bool | yes or no, never a count or a name | new |

### battery (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `level` | int | 0 to 100 | unchanged |
| `state` | string | charging, discharging, full, not-charging | unchanged |
| `plugged` | string | none, ac, usb, wireless | unchanged |
| `present`, `power_save` | bool | | unchanged |
| `technology` | string | at most 32 | unchanged |
| `temperature_c` | int | rounded to 5 | unchanged |

### security (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `lockscreen_set` | bool | | unchanged |
| `biometry_hardware` | string[] | at most 3 of fingerprint, face, iris | unchanged |

### sensors (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `count` | int | | unchanged |
| `only_platform_vendors` | bool | absent when no sensor names a vendor; see section 5 | new |
| `accelerometer`, `gyroscope`, `magnetometer`, `proximity`, `light`, `pressure`, `step_counter`, `heart_rate` | bool | | unchanged |

### audio (fast)

| Field | Type | Status |
|---|---|---|
| `max_music_volume` | int | unchanged |
| `supports_low_latency`, `supports_pro` | bool | unchanged |

### network (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `transport` | string | ethernet, wifi, cellular, bluetooth, vpn | unchanged |
| `underlying_transports` | string[] | at most 5 | unchanged |
| `tunnel_interfaces` | string[] | at most 8, each at most 16 | unchanged |
| `proxy_configured` | bool | | unchanged |
| `sim_absent` | bool | | unchanged |
| `metered` | bool | | unchanged |

### app (fast; scalars are in the velocity cohort)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `package_name`, `version_name` | string | | unchanged |
| `version_code` | int64 | | unchanged |
| `target_sdk`, `min_sdk` | int | | unchanged |
| `updated` | bool | | unchanged |
| `sideloaded` | bool | stays a boolean, see section 5 | unchanged |
| `signature_digest` | hash64 | | unchanged |
| `signature_sha256` | string | 64 hex | unchanged |
| `signer_count` | int | | unchanged |
| `split_count` | int | | unchanged |
| `signer_subject_tokens` | TokenSets | at most 4 signers; `nameHashes` of each subject DN, as `digest128` | new (array, so outside the cohort) |

### root (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `su_paths` | string[] | at most 10, probe paths only; absent when nothing was found and a lookup was denied | changed |
| `su_on_path` | bool | `true` when any `PATH` directory holds `su`; absent when none was found and a lookup was denied | changed |
| `busybox_paths` | string[] | at most 10, probe paths only; absent when nothing was found and a lookup was denied | changed |
| `framework_paths` | string[] | at most 13, probe paths only; absent when nothing was found and a lookup was denied | changed |
| `root_manager_installed`, `hook_manager_installed` | bool | aggregate, see section 5; absent unless the app includes `fingerly-app-checks`, and absent when a lookup threw and no package was found | changed |
| `writable_system` | string[] | at most 7, probe paths only; absent when the check threw | changed |
| `selinux_enforcing` | bool | | unchanged |
| `selinux_context` | string | at most 64, category suffix removed | unchanged |
| `verified_boot_state` | string | at most 16, lowercased | unchanged |
| `boot_locked` | bool | | unchanged |
| `verity_mode` | string | at most 32 | unchanged |
| `boot_properties` | string[] | at most 4; absent when the property store refused a read | changed |
| `ro_debuggable` | string | raw value, at most 8 | new |
| `ro_secure` | string | raw value, at most 8 | new |
| `property_store_refused` | bool | only ever `true`; present only when the property store refused a read | new |
| `stat_access_mismatch` | bool | `Os.access` vs `File.exists` divergence across root/framework probe paths; absent when no path could be checked | new |
| `listing_mismatch` | bool | see below; absent when no path could be checked | new |
| `system_mounts` | object[] | at most 8; see below; absent when the mount table could not be read | new |
| `mount_framework_lines` | int | 0 to 1024; see below; absent with `system_mounts` | new |
| `mounts_truncated` | bool | only ever `true`; present only when the mount table read stopped at its 1,024-line cap | new |
| `probe_errors` | string[] | at most 32; see below | new |

`system_mounts`: one entry per `/proc/self/mounts` line whose mount point is exactly `/system`, `/vendor`,
`/product` or `/system_ext`. Each is `{ "point": string, "type": string (at most 16), "rw": bool }`, where `rw` means the
options field starts with `rw`. These four points and the filesystem type are not free text.

`mount_framework_lines`: how many mount lines have a source or point containing `magisk` (any case) or a point
starting with `/data/adb`. A count because the rest of the table can name other apps (section 5). The table is
`/proc/self/mountinfo`, or `/proc/self/mounts` when that reads empty, at most 1,024 non-blank lines.

`listing_mismatch`: for the `stat_access_mismatch` probe paths (a control path, `su`, `busybox` and `magisk` in each
binary directory, and the framework paths), whether a direct `lstat` and the parent directory's listing (`File.list`,
which reads the directory entries) disagree: the path is present and not listed, or absent and listed. A path whose
lookup is denied, or whose parent cannot be listed, is skipped. Hiding a file from one view and not the other is what
root hiding does.

`probe_errors` names, and the field each one leaves out (`observeRoot`, `collect/RootSource.kt`): `su_paths`,
`busybox_paths`, `framework_paths`, `su_on_path` (a lookup was denied; the field is left out only when nothing was found),
`writable_system`, `stat_access_mismatch`, `listing_mismatch`, `root_manager_installed`, `hook_manager_installed`
(the package lookup threw; the field is left out only when no package was found), `system_mounts` (also leaves out
`mount_framework_lines`).

### emulator (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `qemu_props` | string[] | at most 6, probe names; absent when the property store refused a read | changed |
| `qemu_devices` | string[] | at most 9, probe paths; absent when nothing was found and a lookup was denied | changed |
| `emulator_files` | string[] | at most 17, probe paths; absent when nothing was found and a lookup was denied | changed |
| `telephony` | bool | absent when the package manager could not answer | changed |
| `ro_hardware` | string | raw `ro.hardware`, at most 64 | new |
| `features` | object | see below; absent when the package manager fails | new |
| `probe_errors` | string[] | at most 32: `telephony`, `qemu_devices`, `emulator_files`, `features` | new |

`features`: `{ leanback, television, watch, automotive, pc, arc }`, all bool, from `hasSystemFeature` of
`android.software.leanback`, `android.hardware.type.television`, `.watch`, `.automotive`, `.pc`, `org.chromium.arc`.

### debugger (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `debugger_connected`, `waiting_for_debugger`, `debuggable_build` | bool | | unchanged |
| `tracer_pid` | int | >= 0 | unchanged |
| `adb_enabled`, `development_settings` | bool | | unchanged |
| `test_runners` | string[] | at most 5, probe classes | unchanged |
| `selinux_context` | string | at most 64 | unchanged |

### instrumentation (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `hook_classes` | string[] | at most 6, probe classes; absent when the class lookup threw | changed |
| `foreign_stack_frames` | bool | absent when the stack could not be sampled | changed |
| `open_ports` | int[] | at most 2; absent when a port check failed and no port was found open | changed |
| `artefacts` | string[] | at most 4, probe paths; absent when nothing was found and a lookup was denied | changed |
| `library_hashes` | digest128[] | at most 768; see below; absent when the memory map could not be read | new |
| `library_total` | int | distinct names before the cap; absent with `library_hashes` | new |
| `thread_hashes` | digest128[] | at most 128; `nameHashes` of each thread name, sorted; absent when no thread name could be read | new |
| `thread_total` | int | distinct thread names before the cap; absent with `thread_hashes` | new |
| `exec_regions` | object | int counts; see below; absent when the memory map could not be read | new |
| `maps_truncated` | bool | only ever `true`; present only when the `/proc/self/maps` read stopped at its 16,384-line cap | new |
| `probe_errors` | string[] | at most 32: `maps`, `threads`, `hook_classes`, `foreign_stack_frames`, `open_ports`, `artefacts` | new |

`library_hashes`: `nameHashes` of the leaf of every distinct `/proc/self/maps` region that is executable and whose path
starts with `/` (memfd included). Executable only, to keep the list short: a hooking framework's code always has an
executable segment. When over the cap, take names from trees `other`, `memfd` and `own_data` first, then the rest; inside
each group ascending by hash. Sort the final list.

`exec_regions` counts executable regions in closed buckets, so the list of which trees are normal lives on the
server. Each region goes in exactly one bucket, first match wins:

| Bucket | Region |
|---|---|
| `anon` | no path |
| `label_dalvik` | starts with `[`, contains `dalvik` |
| `label_art` | starts with `[`, contains `art` |
| `label_vdso`, `label_vectors`, `label_sigpage`, `label_stack`, `label_heap` | exactly `[vdso]`, `[vectors]`, `[sigpage]`, `[stack]`, `[heap]` |
| `label_other` | any other path not starting with `/` |
| `file_system` | prefix `/system/` |
| `file_system_ext` | prefix `/system_ext/` |
| `file_vendor` | prefix `/vendor/` |
| `file_product` | prefix `/product/` |
| `file_apex` | prefix `/apex/` |
| `file_odm` | prefix `/odm/` |
| `file_data_app` | prefix `/data/app/`, or `/mnt/expand/<volume>/app/` (an app moved to adopted storage is the same install on another volume; `user/` beside it is app data and stays `file_other`) |
| `file_apexdata` | prefix `/data/misc/apexdata/` |
| `file_dalvik_cache` | prefix `/data/dalvik-cache/` |
| `file_dev` | prefix `/dev/` |
| `file_memfd` | prefix `/memfd:` |
| `file_metadata` | prefix `/metadata/` |
| `file_resource_cache` | prefix `/data/resource-cache/` |
| `file_own_data` | prefix is the app's own data directory |
| `file_other` | any other path starting with `/` |

### cloned (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `data_dir_expected`, `data_dir_in_other_app` | bool | see section 5 | unchanged |
| `stub_process_name` | bool | see section 5; absent when the process name could not be read | changed |
| `cloner_installed` | bool | see section 5; absent unless the app includes `fingerly-app-checks`, and absent when a lookup threw and no package was found | changed |
| `foreign_sandbox_maps` | int | count, never names; absent when the memory map could not be read | changed |
| `user_id` | int | | unchanged |
| `is_managed_profile` | bool | absent below API 30 (no zero-permission query) and when the query failed | new |
| `is_device_protected_storage` | bool | `false` below API 24; absent when the query failed | new |
| `probe_errors` | string[] | at most 32: `maps`, `stub_process_name`, `is_managed_profile` (API 30 and up), `is_device_protected_storage`, `cloner_installed` | new |

### images (deferred)

| Field | Type | Status |
|---|---|---|
| `count` | int | unchanged |
| `digest` | digest128 | changed |
| `executable_regions` | int | unchanged |

### attest (deferred)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `chain` | string[] | base64 certs, at most 32 KiB decoded | unchanged |
| `chain_length`, `chain_carried` | int | | unchanged |
| `challenge` | string | base64 | unchanged |
| `challenge_source` | string | server or device | unchanged |
| `secure_hardware` | bool | | unchanged |
| `security_level` | string | at most 32 | unchanged |

Challenge flow: the SDK requests a nonce from `POST /api/v1/attestation/challenge` (32 random bytes, five minutes,
single use, bound to the SDK key), has the hardware keystore attest a fresh key to it, and sends the chain with
`challenge` and `challenge_source: "server"`. If the request fails, the SDK generates a nonce and sends
`challenge_source: "device"`; such a chain is never treated as proven. The chain is forwarded verbatim and only the
server reads what is inside it: the server checks it against the published roots, the application ID in the extension
against the report and the key's `allowed_android_packages` and `allowed_android_signers`, and spends the challenge.

### play_integrity (deferred, optional)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `token` | string | at most 16 KiB; removed from the report before it is stored | new |
| `request_hash` | string | 64, lowercase hex SHA-256 of the server's challenge | new |
| `challenge` | string | base64, the same server nonce as `attest.challenge` | new |

Present only in reports of apps that add the optional `io.fingerly:fingerly-play-integrity` artifact (server ADR
0026). `unsupported` when the challenge did not set `play_integrity`, which the server sets only for a project with its
own Google service account and within its daily decode budget; `blocked` when the token could not be made. The server
decodes the token at most once with the customer's service account, checks the package, the request hash and the
timestamp, and reports Google's verdicts. Its absence is never evidence.

### tls (deferred)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `user_ca_count` | int | | unchanged |
| `probe_skipped` | bool | | unchanged |
| `handshake_failed` | bool | | unchanged |
| `failure` | string | at most 64, class name only | unchanged |
| `chain_length` | int | | unchanged |
| `system_trusted` | bool | | unchanged |
| `root_key_sha256` | string | base64 | new |
| `leaf_expires_at` | int | epoch seconds | unchanged |
| `chain_subject_tokens` | TokenSets | at most 6 certs, leaf first; `nameHashes` of subject and issuer DN joined by a space, as `digest128` | new |

### integrity

| Field | Type | Bounds | Status |
|---|---|---|---|
| `native_methods` | object[] | at most 32, see below | new |
| `unresolved` | string[] | watched names that could not be resolved, in watch-list order; omitted when empty | new |

`native_methods`: one entry per watched method present on this OS. `{ "method": "java.io.File!exists", "declared": int, "native": int }`:
how many overloads were checked and how many report `Modifier.isNative`. The watched methods are the `native_methods` list
in [watchlist-android.json](./watchlist-android.json). A method whose class or method is missing on this OS, or whose
lookup threw, has no entry and is named in `unresolved` instead (`nativeMethodCounts`, `integrity/Integrity.kt`): a
suppressed lookup never looks like a shorter list. The server counts every watched name that has no entry or is listed in
`unresolved` (`watchlistGaps`, `domain/risk/watchlist.go`) as tampering evidence `watchlist-incomplete`, 0.25 per name up
to 1.25, unless the whole table is missing or empty, which already fires `missing-native-methods`.

### device

Removed entirely. See section 6.

## 3. iOS report

### system (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `os_version`, `os_build`, `os_type`, `uname_release` | string | `os_version` is the Darwin release from `kern.osrelease` (for example `25.5.0` on iOS 26), never the iOS marketing version; the server maps it to the iOS major | unchanged |
| `kernel_version` | hash64 | | unchanged |
| `simulator_model`, `simulator_runtime` | string | | unchanged |
| `simulator_environment` | string[] | at most 5, key names only | unchanged |
| `simulator_build` | bool | | unchanged |
| `active_processors` | int | sent only on a simulator (iOS ADR 0001) | unchanged |

### hardware (fast; in the velocity cohort)

| Field | Type | Status |
|---|---|---|
| `machine`, `uname_machine`, `model`, `target`, `product` | string | unchanged |
| `gpu_family_max` | int | new (outside the cohort) |

### display (fast)

| Field | Type | Status |
|---|---|---|
| `width`, `height`, `native_width`, `native_height` | int | unchanged |
| `scale`, `native_scale` | double | unchanged |

A process with no application object (`UIApplication.shared` is nil, as in a test bundle without a host app) has no screen
to describe: the source is `{ status: "unsupported", reason: "no-application" }` with no value, and `UIScreen` is never
touched, because its first use waits on the main thread for a launch context such a process never gets.

### storage (fast)

| Field | Type | Status |
|---|---|---|
| `container_age_d` | int | unchanged |

No capacity, free space or boot time: required-reason APIs whose approved reasons keep the value on the device.

### intl (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `timezone` | string | | unchanged |
| `locale` | string | `language[-Script][-REGION]` only, no `-u-` extensions | unchanged; reduced (iOS ADR 0001) |

### accessibility (fast)

Retired (iOS ADR 0001). The id is still sent, as `{ status: "unsupported", reason: "retired" }` with no value, so that
section 8.11 does not read it as omitted. No API is called.

### battery (fast)

Retired (iOS ADR 0001), sent as `unsupported` with reason `retired` and no value.

### security (fast)

| Field | Type | Status |
|---|---|---|
| `passcode_set` | bool | unchanged |
| `biometry_reason` | string | unchanged |

### sensors (fast)

| Field | Type | Status |
|---|---|---|
| `accelerometer`, `gyroscope` | bool | unchanged |

### audio (fast)

Retired (iOS ADR 0001), sent as `unsupported` with reason `retired` and no value.

### network (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `radio_services` | int | | unchanged |
| `proxy_configured`, `proxy_auto_config` | bool | | unchanged |
| `transport` | string | wifi, cellular, wired | unchanged |
| `interface_types` | string[] | at most 5 | unchanged |

### app (fast; scalars are in the velocity cohort)

| Field | Type | Status |
|---|---|---|
| `bundle_id`, `version`, `build`, `min_os`, `sdk_build`, `xcode_build`, `process_name` | string | unchanged |
| `is_app_bundle`, `has_provisioning_profile`, `development_profile`, `has_receipt`, `has_code_signature`, `mac_catalyst`, `ios_app_on_mac` | bool | unchanged |
| `argument_count` | int | unchanged |

### identity (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `install_id` | string | UUID | unchanged |
| `launches` | int | >= 1 | unchanged; meaning changes to once per process (P3) |
| `install_age_h` | int | may be negative after P4 | unchanged; stop clamping to 0 (P4) |

### jailbreak (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `injectors` | string[] | at most 10, probe paths | unchanged |
| `userland` | string[] | at most 10, probe paths | unchanged |
| `rootless_prefix_present`, `rootless` | bool | | unchanged |
| `schemes_queryable` | bool | | unchanged |
| `managers_found` | int | 0 to 10 | renamed (from `managers`, string[]) |
| `artefacts_found` | int | 0 to 12 | renamed (from `artefacts`, string[]) |
| `schemes_found` | int | 0 to 7 | renamed (from `schemes`, string[]) |
| `dyld_insert_libraries_set` | bool | | renamed (from `dyld_insert_libraries`, which sent the variable's value) |

### debugger (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `traced`, `parent_is_launchd`, `debug_build` | bool | | unchanged |
| `parent_pid` | int | | unchanged |
| `automation_environment` | string[] | at most 9, key names only | unchanged |

### instrumentation (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `thread_count` | int | every thread `task_threads` returns, named or not; 0 when the call fails | unchanged |
| `open_ports` | int[] | at most 2 | unchanged |
| `library_hashes` | digest128[] | at most 768; see below | new |
| `library_total` | int | images considered before the cap | new |
| `thread_hashes` | digest128[] | at most 128; `nameHashes` of each thread name, sorted | new |
| `thread_total` | int | distinct thread names before the cap | new |
| `app_image_hashes` | digest128[] | at most 128; `nameDigest` of the lowercased path of each image inside the app, relative to the container (`@app/...`), sorted | new |
| `image_trees` | object | int counts by tree; see below | new |

`library_hashes`: for every loaded image except `sim_root` images and `system_library` images that the dyld shared cache
contains (those are the bulk of a real app's images and are not where an injected library lives; a standalone
`system_library` image outside the cache is hashed): `nameHashes` of the leaf, plus `nameHashes` of the name of its
immediate parent directory. The parent is there because today's match runs on the whole path, and every tweak lives under a
telling directory (`/Library/MobileSubstrate/DynamicLibraries/x.dylib`, `/usr/lib/TweakInject/x.dylib`). When over the cap,
take trees `other`, `app_bundle`, `app_parent` and `loaded_bundle` first, then the rest; inside each group ascending by hash.
Sort the final list.

`image_trees` counts all loaded images, first match wins. Paths are compared with `/private/var/` read as `/var/`. Trees:

- `sim_root`: simulator builds only. The prefix is the value of `SIMULATOR_ROOT`, `DYLD_ROOT_PATH` or
  `IPHONE_SIMULATOR_ROOT`. A device build never reads these variables, so setting them cannot hide an image.
- `usr_lib`: under `/usr/lib/` or `/System/Cryptexes/OS/usr/lib/`, and either contained in the dyld shared cache
  (`_dyld_shared_cache_contains_path`) or one of the standalone images `/usr/lib/dyld` and
  `/usr/lib/libffi-trampolines.dylib` whose file starts with a Mach-O header. Any other image under these prefixes is `other`.
- `system_library`: under `/System/Library/`, `/System/Cryptexes/OS/System/Library/` or `/System/iOSSupport/System/Library/`,
  and either contained in the dyld shared cache or a standalone image under `/System/Library/Extensions/`,
  `CoreServices/`, `Components/` or `AccessibilityBundles/` whose file starts with a Mach-O header. Any other image under
  these prefixes is `other`.
- `system_applications` (`/System/Applications/`), `library_apple` (`/Library/Apple/`).
- `app_bundle`: the main bundle path.
- `loaded_bundle`: a `Bundle.allBundles` path inside the app's container only: below the bundle's parent directory, not
  the main bundle itself, no `..` segment, and with a code bundle extension (`app`, `appex`, `framework`, `bundle`,
  `xctest`, `plugin`). A bundle anywhere else on the device does not count, and its images fall through to `other`.
- `app_parent`: the bundle's parent directory (the container).
- `other`: everything else.

The Mach-O header test reads the first 16 bytes without blocking: a thin header (`MH_MAGIC`, `MH_MAGIC_64`) of an
executable, dylib, dynamic linker, bundle or kext bundle, or a universal header. A name or a prefix alone never makes an
image a system image.

### images (fast)

| Field | Type | Status |
|---|---|---|
| `count` | int | unchanged |
| `digest` | hash64 | unchanged |

### fonts (deferred)

Retired (iOS ADR 0001), sent as `unsupported` with reason `retired` and no value.

### attest (deferred)

| Field | Type | Status |
|---|---|---|
| `devicecheck_supported`, `app_attest_supported` | bool | unchanged |
| `device_token` | string | changed: base64, at most 4 KiB decoded; sent only when the challenge sets `device_check`, beside the `app_attest` evidence that covers it; removed from the report before it is stored (server ADR 0026) |
| `device_check_error` | string | new: at most 24, a status token such as `devicecheck-<code>` when the token could not be made; App Attest carries on |
| `app_attest` | object | App Attest evidence, or absent; removed from the report before it is stored |
| `app_attest.mode` | string | `attestation` for a new key, `assertion` for every later report |
| `app_attest.key_id` | string | base64, 32 bytes decoded; stored only as a SHA-256 and never in identity or the velocity cohort |
| `app_attest.object` | string | base64, the attestation or assertion object, at most 32 KiB decoded |
| `app_attest.challenge` | string | base64, the server's nonce |
| `app_attest.challenge_source` | string | `server`; only that can ever be attested |

App Attest flow: the SDK requests a nonce from `POST /api/v1/attestation/challenge`, whose answer sets `app_attest`
when the key has an Apple app ID configured. The app needs the capability
`com.apple.developer.devicecheck.appattest-environment`, or generating a key fails and the report carries no evidence.
The first report from an install attests a new key with Apple, and every later one signs an assertion over the nonce.
The key identifier is kept in the app's own container, not the keychain, so it is scoped to the install. The server
verifies the object against Apple's root and the key's `allowed_apple_app_ids`, and records the event as `attested`,
`not_attested` or `failed`. A report without proof fires `attestation_missing` only on a production or staging key
with an Apple app ID configured, on iOS 14 or newer.

A forgotten key (server ADR 0026, amended 2026-11-11): the server deletes a key after 180 days without an assertion and
with a purged project. An assertion under a key it does not hold is `not_attested` with reason `attestation-key-unknown`,
and the identify answer carries `app_attest_key: "unknown"`; where the SDK key requires attestation the report is refused
with `403 attestation_key_unknown` instead of `attestation_required`. On either, the SDK marks the key it asserted with for
replacement (only while that key is still the one it stores) and attests a new key on its next collection. Replacements
are rate limited on the device, because Apple's risk metric counts the keys a device attests in 30 days: the first is
immediate, the next waits 7 days, then 14, then 30 days for good, and the count restarts after 90 days without one.

DeviceCheck (server ADR 0026): when the project has its own Apple key with DeviceCheck switched on, the challenge also
sets `device_check`. The SDK then generates two DeviceCheck tokens and sends them in the top-level `attest` envelope as
`device_token` and `device_token_write`, both bound into `statementDigest` through `deviceTokenDigest`
([v3-envelope.md](./v3-envelope.md) section 3.2). The server holds both sealed for one hour only when that evidence
verifies. The customer's backend spends the first with one read of the device's two bits and the second with one write,
so a single identification supports a read and a write.

### tls (deferred)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `chain_length` | int | after trust evaluation (P5) | unchanged |
| `root_key_sha256` | string | base64 | unchanged |
| `system_trusted` | bool | | unchanged |
| `clock_skew_s` | int | | unchanged |
| `handshake_failed` | bool | P5 | new |
| `chain_subject_tokens` | TokenSets | exactly leaf then root, at most 2; `nameHashes` of `SecCertificateCopySubjectSummary`, as `digest128` | new |

### integrity

| Field | Type | Bounds | Status |
|---|---|---|---|
| `native_symbols` | object[] | at most 32; see below | new |
| `objc_methods` | object[] | at most 32; see below | new |
| `got_slots` | object[] | at most 32; always present, empty when no watched import has a slot; see below | new |
| `unresolved` | string[] | watched names that could not be measured, sorted, no duplicates; omitted when empty | new |

`native_symbols`: one entry per watched function that `dlsym` resolves and `dladdr` places:
`{ "symbol": string, "image": ImageRef, "tree": string, "prologue": string?, "branch_image": ImageRef?, "branch_tree": string?, "branch_resolved": bool? }`.
`tree` and `branch_tree` use the `image_trees` vocabulary (`unresolved` when `dladdr` cannot place the branch target). `prologue` is the 16 bytes at `dli_saddr` as 32 hex characters, read with
`vm_read_overwrite`, sent only when `tree` is `usr_lib`, `system_library`, `library_apple` or `sim_root` and the read succeeded.
`branch_resolved`, `branch_image` and `branch_tree` are sent when the prologue branches out of line (e.g. `B imm26` or `ADRP+ADD+BR`):
whether `dladdr` placed the target, which image it is, and which tree owns it. The client does the branch arithmetic because the server has no
address map. Nothing here needs a private API, and system bytes are the same on every device on one OS build.

`objc_methods`: one entry per watched method that resolves: `{ "method": "NSFileManager fileExistsAtPath:", "image": ImageRef?, "tree": string, "isa_swizzled": bool?, "msg_forward": bool? }`,
with `tree` set to `unresolved` when `dladdr` cannot place the implementation, `isa_swizzled` true when a singleton instance's runtime `object_getClass` disagrees with its declared class, and `msg_forward` true when the method implementation points to `_objc_msgForward`.

`got_slots`: Mach-O `__DATA_CONST,__got` / `__la_symbol_ptr` slot bindings for watched C imports: `{ "symbol": string, "image": ImageRef?, "tree": string }`, using the `image_trees` vocabulary (`unresolved` when `dladdr` cannot place the bound pointer). The array is always sent, empty when no watched import has a slot in the image, so the server can tell "inspected" from "not inspected".

`unresolved`: the watched names, from the `native_symbols` and `objc_methods` lists in [watchlist-ios.json](./watchlist-ios.json),
that could not be measured: a function `dlsym` does not resolve or `dladdr` cannot place, and a method (`Class selector`) whose
class or implementation cannot be found (`measureIntegrity`, `Integrity/Hooks.swift`). Such a name has no table entry and is
listed here instead of being dropped. The server counts every watched name that has no entry or is listed in `unresolved`
(`watchlistGaps`, `domain/risk/watchlist.go`) as tampering evidence `watchlist-incomplete`, 0.25 per name up to 1.25, so a
function an older iOS does not have yet (two names on iOS 13) stays below the tampering bar on its own.

### device

Removed entirely. See section 6.

## 4. Fields that embed a judgement today, and how each becomes raw

| Today | Platform | Becomes | Server does |
|---|---|---|---|
| `known_interceptor` | both | `tls.chain_subject_tokens` | token test against the interceptor set, per cert |
| `virtual_board` | Android | `hardware.hardware`, `hardware.board`, `emulator.ro_hardware` | exact match against `virtualBoards` |
| `build_indicators` | Android | `system.fingerprint`, `system.build_id`, six `hardware.*` strings | substring match against `buildTokens` |
| `emulator.cpu_hardware` | Android | `hardware.cpu_hardware` | substring match against `virtualCpus` |
| `dangerous_props` | Android | `root.ro_debuggable`, `root.ro_secure` | compares to `1` and `0` |
| `mount_anomalies` | Android | `root.system_mounts`, `root.mount_framework_lines` | section 8.1 |
| `form_factor` | Android | `emulator.features` | `handset` predicate |
| `foreign_count` | both | Android `exec_regions.file_other`, iOS `image_trees.other` | `> 0` |
| `anonymous_exec_maps` | Android | `exec_regions` | `anon + label_other + file_other` |
| `libraries` | Android | `library_hashes` | marker set |
| `images`, `automation_images` | iOS | `library_hashes` | two marker sets |
| `threads` | both | `thread_hashes` | marker set |
| `software_rooted` | Android | `attest.chain_length` | `<= 1` |
| `debug_signed` | Android | `app.signer_subject_tokens` | tokens `android` and `debug` in one set |
| `settings_changed` | Android | four scales, timeout, `any_service_enabled` | section 8.7 |
| `settings_changed` | iOS | stays a count; no longer sent since iOS ADR 0001 (source retired) | section 5 |
| `biometry_unusable` | Android | `biometry_hardware`, `lockscreen_set` | non-empty and false |
| `integrity.lies` swizzled | both | Android `native_methods`, iOS `objc_methods` | count hooked |
| `integrity.lies` contradiction, injected, missing | both | nothing new | section 8.12, from sources and statuses |
| `patched_natives` | iOS | `native_symbols` | section 8.11 |
| `engine.agrees` | both | nothing new | section 8.12; no native detector reads it |
| `tunnelled` | both | transport lists | membership |

## 5. Fields that stay as a client-side boolean or count

Each is a measurement of a raw value the store rules forbid sending, or that carries more than its rule reads.
None says what the device is.

| Field | Platform | What it measures | Why the raw value cannot leave |
|---|---|---|---|
| `root_manager_installed`, `hook_manager_installed` | Android | a lookup on a fixed package list answered yes | other apps appear only as yes or no (Play User Data) |
| `cloner_installed` | Android | the same | the same |
| | | The three package booleans are present only when the app includes `fingerly-app-checks`, and `false` means "not seen", not "not on the device": no rule may read them with `isFalse` | |
| `only_platform_vendors` | Android | every distinct sensor vendor is an OS placeholder (`isPlatformSensorVendor`, section 8.2) | vendor names are free text that only this predicate reads |
| `data_dir_expected` | Android | own data directory has one of four platform shapes | no raw data directory; it holds the cloner's package |
| `data_dir_in_other_app` | Android | own data directory sits in a package other than ours | the same |
| `stub_process_name` | Android | own process name does not start with our package | the name holds the cloner's package |
| `foreign_sandbox_maps` | Android | count of other apps' sandboxes mapped in | no other app's sandbox path |
| `mount_framework_lines` | Android | count of mount lines naming the probe word or path | mount points can name other apps' data directories |
| `sideloaded` | Android | installer is not on the store list | no raw installer package |
| `signature_changed` | Android | signing certificate differs from this install's stored one | a comparison against local history; the current digest is sent |
| `any_service_enabled` | Android | at least one accessibility service is on | no service names, and only ever lowers farm evidence |
| `reinstalled` | iOS (no longer sent since iOS ADR 0001) | stored vendor ID differs from the live one | no OS device identifier may leave |
| `managers_found`, `artefacts_found`, `schemes_found` | iOS | how many probe paths or schemes answered | other apps only as counts (matches Android); these lists name apps |
| `dyld_insert_libraries_set` | iOS | the variable is set | its value is a list of file paths |
| `settings_changed` | iOS (no longer sent since iOS ADR 0001) | how many of 19 toggles plus text size are off default | which toggle is on can reveal a disability (VoiceOver, Switch Control) |
| `debug_build`, `development_profile` | iOS | embedded profile says `get-task-allow` | the profile is the customer's signed file |
| `foreign_stack_frames` | Android | a probe-listed package appears on our own stack | a tool-name test (probe list), and a stack is free text |

Accessibility is never fraud evidence. On Android `any_service_enabled` can only *clear* `no-settings-ever-changed`;
no rule may raise a score because a service is on.

## 6. Removed entirely

- `sources.device`: `root_apps`, `jailbreak`, `emulator`, `simulator`, `cloned_app`, `frida`, `mitm_attack`,
  `developer_tools`, `tampering`, `device_farm`, `vpn_mobile`, `timezone`, `locale`, `confidence`, `reasons`. The server reads
  `sources.intl` for timezone and locale already. `active_call` was never sent by either SDK and stays silent.
- `verdicts`, `confidence`, `reasons` and the `Evidence` type, from the report and from the public SDK API
  (`Verdict`, `Verdicts`, `detect/`, `Summarize`, `weigh`). Bridges lose them too.
- `integrity.patched_natives`, `integrity.lies`, `integrity.engine` on native.
- On the server, native reports stop reading `nativeSignals` and top-level booleans. A forged `"root_apps": true` must do nothing.

## 7. Report size

The ingest routes refuse a body over 1 MiB (`DefaultMaxBodySize`). In JSON one `digest128` costs 35 bytes (32 hex
characters, two quotes, a comma) on both platforms. The hash-bearing fields below dominate a report; everything else is
about 4 KB.

| | Android typical | Android at every cap | iOS typical | iOS at every cap |
|---|---|---|---|---|
| `library_hashes` | about 400 digests, 14.0 KB | 768 digests, 26.9 KB | about 180 digests, 6.3 KB | 768 digests, 26.9 KB |
| `thread_hashes` | about 58 digests, 2.0 KB | 128 digests, 4.5 KB | 0.7 KB | 128 digests, 4.5 KB |
| chain and signer tokens | about 42 digests, 1.5 KB | 240 digests (6 certs and 4 signers, 24 each), 8.4 KB | 0.7 KB | 48 digests, 1.7 KB |
| integrity tables, regions, mounts, features | 1.0 KB | 1.3 KB | 3.2 KB (with `app_image_hashes` and trees) | 7.5 KB |
| **Total of these fields** | **about 18.5 KB** | **about 41 KB** | **about 11 KB** | **about 41 KB** |

So a typical report is about 23 KB on Android and about 15 KB on iOS, roughly 11 KB and 7 KB gzipped (hex digests compress
about 2 to 1). The worst case, Android at every cap with its 32 KiB attestation chain as base64 (about 44 KB), is about 90 KB:
under 9 percent of the limit.

These are estimates from the SDKs' own notes (two to four hundred distinct mapped files on a real Android app), not device
measurements. The caps are what hold the worst case.

## 8. Detector specification

The server port implements this exactly. `[proposed]` marks a change this contract asks for beyond today's client behaviour; see
section 9. A rule list is "add this weight when this holds". Weights and reason tokens are as written.

### Shared mechanics

- `evidence.verdict()` in `domain/risk/evidence.go`, unchanged: fires at `sum >= 1.0`, medium at `>= 1.25`, high at `>= 2.0`.
  Reason is the top three tells joined with `+`.
- A detector whose source is not `ok` is silent, unless a rule below tests `status`.
- A reason never holds raw client text. Every value that came from the client passes through `reasonToken`: lowercase `[a-z0-9._-]`, at most
  64 bytes, unsafe bytes dropped (uppercased again for a region code). This covers browser and native paths alike.
- A rule that reads a field from another source needs that source `ok` too. `x == false` needs the field present; `x != "cellular"`
  holds when `x` is absent, exactly as the Kotlin and Swift do today.
- Confidence becomes evidence-derived instead of always high. It does not change a score: `score.go` only applies confidence to the VPN
  and residential-proxy modes.
- Signal names: `root_apps`, `emulator`, `app_cloner`, `frida`, `mitm_attack`, `developer_tools`, `tampering`, `device_farm`, `vpn_mobile`,
  `jailbreak`, `simulator`. Customer weights stay in `weights.go`, unchanged.
- `handset` (Android): `emulator.features` absent, or none of `leanback`, `television`, `watch`, `automotive`, `pc`, `arc` is true.
- `mac` (iOS): `app.mac_catalyst` or `app.ios_app_on_mac` is true.

### 8.1 Android: root_apps

Source `root`. If `sources.root.status == "blocked"`: single tell `root-probe-blocked` 1.4. Not ok otherwise: silent.

`mountAnomalies` = distinct `rw:point` for `system_mounts` with `rw` + distinct `type:point` with type `overlay` or `tmpfs` + `mount_framework_lines`.

| Condition | Weight | Reason |
|---|---|---|
| `su_paths` non-empty | 1.4 | `su-binary-<leaf>` |
| `framework_paths` non-empty | 1.5 | `root-framework-<leaf>` |
| `writable_system` non-empty | 1.3 | `system-writable-<n>` |
| `mountAnomalies > 0` | 1.0 | `mount-anomaly-<n>` |
| `selinux_enforcing == false` | 1.2 | `selinux-permissive` |
| `verified_boot_state == "red"` | 1.2 | `boot-verification-failed` |
| `system.build_tags` contains `test-keys`, and not `emulatorHard` [proposed P6] | 0.8 | `build-signed-with-test-keys` |
| `ro_debuggable == "1"` or `ro_secure == "0"`, once, and not `emulatorHard` [proposed P6] | 0.4 | `dangerous-prop-<first>` |
| `root_manager_installed` | 0.7 | `root-manager-installed` |
| else `hook_manager_installed` | 0.7 | `hook-manager-installed` |
| `stat_access_mismatch` | 0.7 | `stat-access-mismatch` |
| `listing_mismatch` | 1.4 | `root-hidden-listing-mismatch` |
| `busybox_paths` non-empty | 0.5 | `busybox-present` |
| `su_on_path` and `su_paths` empty | 1.2 | `su-on-path-but-not-stattable` |

`emulatorHard`: `emulator` ok and (`qemu_props` or `qemu_devices` non-empty, or a virtual board matched).

### 8.1a Android: bootloader_unlocked

Source `root`. An unlocked bootloader makes root possible without being it, so the boot state is its own signal and
no longer root evidence (only a failed verification, `red`, stays in 8.1).

| Condition | Weight | Reason |
|---|---|---|
| `verified_boot_state == "orange"` | 1.3 | `bootloader-unlocked` |
| `verified_boot_state == "yellow"` | 1.0 | `boot-image-self-signed` |
| `boot_locked == false` | 1.0 | `bootloader-reports-unlocked` |

The attested root of trust says the same with high confidence when the report carries a verified key attestation:
an unlocked bootloader or an `unverified` boot is `attested-bootloader-unlocked` / `attested-verified-boot-unverified`
(high), a `self-signed` boot `attested-verified-boot-self-signed` (low), and a `failed` boot is `root_apps`. A report
that claims a stronger boot than the hardware attested (`green` or `boot_locked: true` on an unlocked or unverified
boot) is `device_inconsistent`, `keystore-boot-state-mismatch`; one that says `orange` truthfully is not.

### 8.2 Android: emulator

Source `emulator`.

| Condition | Weight | Reason |
|---|---|---|
| `qemu_props` non-empty | 1.6 | `qemu-property-set` |
| any of `hardware.hardware`, `hardware.board`, `emulator.ro_hardware`, lowercased, is in `virtualBoards` (use the first that is) | 1.5 | `virtual-board-<board>` |
| `qemu_devices` non-empty | 1.4 | `emulator-device-<leaf>` |
| `emulator_files` non-empty | 1.5 | `emulator-artefact-<leaf>` |
| `describes` contains a `buildTokens` entry | 1.2 | `build-identity-<token>` |
| `hardware.cpu_hardware`, lowercased, contains a `virtualCpus` entry | 1.3 | `cpuinfo-hardware-<cpu>` |
| `handset`, `sensors.accelerometer == false`, `sensors.gyroscope == false` | 0.8 | `no-motion-sensors` |
| `sensors.only_platform_vendors == true` [proposed, Android ADR 0001]; for 0.1.0 reports, `sensors.vendors` non-empty and all platform vendors | 1.1 | `all-sensors-vendored-by-the-os` |
| `attest.secure_hardware == false` | 0.9 | `no-hardware-backed-keystore` |
| `handset`, any `hardware.abis` starts with `x86` | 0.5 | `x86-abi-on-handset` |
| `handset`, `emulator.telephony == false` | 0.05 | `no-telephony-hardware` |

`describes`: lowercase, space-joined `system.fingerprint`, `hardware.model`, `.product`, `.device`, `.board`, `.hardware`, `.brand`, `.manufacturer`,
`.bootloader`, `system.build_id`. Today's list also had `Build.HOST`; see section 10.

Platform vendor (lowercased): contains `aosp`, `android open source`, `goldfish` or `ranchu`, or equals `android`, `google`, `google inc.` or `unknown`.

### 8.3 Android: app_cloner

Source `cloned`. `hosted` = `data_dir_in_other_app == true`.

| Condition | Weight | Reason |
|---|---|---|
| `hosted` | 1.8 | `data-dir-inside-another-app` |
| `data_dir_expected == false` and not `hosted` | 1.3 | `data-dir-not-a-platform-path` |
| `user_id == 999` | 1.5 | `oem-dual-app-profile` |
| `foreign_sandbox_maps > 0` | 1.3 | `foreign-sandbox-mapped-<n>` |
| `stub_process_name` | 1.0 | `virtualised-process-name` |
| `cloner_installed` | 0.6 | `cloning-app-installed` |
| `user_id > 0` and not 999 | 0.3 | `secondary-android-user-<n>` |

### 8.4 Android: frida (instrumentation)

Source `instrumentation`.

| Condition | Weight | Reason |
|---|---|---|
| `library_hashes` meets the Android library set | 1.6 | `instrumentation-library-<marker>` |
| `hook_classes` non-empty | 1.4 | `hook-framework-class-<first>` |
| `foreign_stack_frames` | 1.3 | `hook-frames-in-own-stack` |
| `thread_hashes` meets the Android thread set | 1.2 | `instrumentation-thread-<marker>` |
| `open_ports` non-empty | 1.1 | `frida-port-<first>-open` |
| `artefacts` non-empty | 1.2 | `frida-artefact-<leaf>` |
| `exec_regions.anon + label_other + file_other > 0` | 0.7 | `anonymous-executable-maps-<n>` |

`thread-enumeration-hooked` needs a native prologue scan, which Android has never run, so it cannot fire there.

### 8.5 Android: mitm_attack

| Condition | Weight | Reason |
|---|---|---|
| `tls` ok, a cert in `chain_subject_tokens` meets the interceptor set | 1.8 | `interception-ca-<marker>` |
| `tls` ok, `system_trusted == false` | 1.5 | `chain-not-system-trusted` |
| `tls` ok, `chain_length == 1` | 0.7 | `chain-length-1` |
| `tls` ok, `handshake_failed` | 0.3 | `tls-handshake-failed` |
| `sources.tls.status == "blocked"` | 0.3 | `tls-probe-blocked` |
| chain evidence, `tls` ok, `user_ca_count > 0` | 0.95 | `user-installed-ca-<n>` |
| chain evidence, `network` ok, `proxy_configured` | 0.9 | `http-proxy-configured` |

Chain evidence is: an interceptor token, `system_trusted == false`, `chain_length == 1`, or `handshake_failed`. A user CA and a configured
proxy are what a managed device looks like, so on an ordinary system-trusted chain they prove nothing about this connection and stay silent;
they count only once the chain itself is suspect, and a handshake that failed with them in place is suspect in itself. A timed-out or
blocked `tls` has no chain to accuse, so neither is chain evidence.

Length 1 only, and user CA at 0.95 are false-positive fixes: 2 is a normal chain, and one managed-device CA alone must not fire.

### 8.6 Android: developer_tools (automation)

Source `debugger`.

| Condition | Weight | Reason |
|---|---|---|
| `debugger_connected` or `tracer_pid > 0` | 1.6 | `debugger-attached` |
| `waiting_for_debugger` | 1.4 | `waiting-for-debugger` |
| `test_runners` non-empty | 1.5 | `test-runner-<first>` |
| `adb_enabled` | 0.8 | `adb-enabled` |
| else `development_settings` | 0.5 | `developer-options-enabled` |
| `debuggable_build` | 0.6 | `debuggable-application` |

ADB and developer options count once: USB debugging lives inside them, so both together must stay below the threshold.
Accessibility services are not in this detector and must not be added.

### 8.7 Android: device_farm

Silent when `security`, `accessibility` and `storage` are all not ok.

`settingsChanged`, from `accessibility`: one each for `font_scale != 1.0`; `animator_scale`, `transition_scale`, `window_scale` present and `!= 1.0`;
`screen_never_sleeps`, or `screen_off_timeout_s` present and not 30 or 60; `any_service_enabled`. The rule below needs `accessibility` ok.

Facts count in full:

| Condition | Weight | Reason |
|---|---|---|
| `system.device_provisioned == false` | 1.0 | `setup-never-completed` |
| `handset`, `network.transport == "ethernet"` | 0.9 | `wired-ethernet-on-handset` |
| `identity.launches > 20` and `install_age_h == 0` | 1.0 | `launch-rate-<n>-in-under-an-hour` |

Circumstantial tells are capped together at 0.9, so owner choices alone can never fire. An empty disk is here rather than with the facts: a
factory-reset or brand new phone is exactly this and exactly ordinary.

| Condition | Weight | Reason |
|---|---|---|
| `storage.free_ratio > 0.95` | 0.7 | `disk-almost-entirely-empty` |
| `security.lockscreen_set == false` | 0.8 | `no-lockscreen-set` |
| `biometry_hardware` non-empty and `lockscreen_set == false` | 0.15 | `biometry-hardware-unusable` |
| `settingsChanged == 0` | 0.6 | `no-settings-ever-changed` |
| `battery.state` charging or full, `level >= 95` | 0.4 | `battery-full-and-charging` |
| `network.sim_absent` and `transport != "cellular"` | 0.25 | `no-cellular-service` |
| `system.booted_recently` | 0.5 | `booted-within-five-minutes` |

`owed` = sum of circumstantial weights. `scale` = `0.9 / owed` when `owed > 0.9`, else 1. Add each circumstantial tell at `weight * scale`.
Exactly zero for the age: a clock set back gives a negative age, which says nothing.

### 8.8 Android: vpn_mobile

`network` ok and `underlying_transports` contains both `vpn` and `cellular`. High confidence, reason `device-vpn-over-cellular`. Records through the
existing `record(SignalVPNMobile, ...)` path. Fires outside `evidence`.

### 8.9 iOS: jailbreak

Source `jailbreak`. If `status == "blocked"`: single tell `jailbreak-probe-blocked` 1.4. If `system` ok and (`simulator_build` or `simulator_environment` non-empty): silent.

| Condition | Weight | Reason |
|---|---|---|
| `injectors` non-empty | 1.3 | `injection-library-<leaf>` |
| `managers_found > 0` | 0.9 | `package-managers-<n>` |
| `rootless_prefix_present` | 1.4 | `rootless-prefix-present` |
| `userland` non-empty | 1.1 when 3 or more paths, else 0.7 | `unix-userland-<n>-paths` |
| `artefacts_found > 0` | 0.8 | `jailbreak-artefacts-<n>` |
| `symlinked_directories` non-empty (no longer sent since iOS ADR 0001; the rule never fires on a current report) | 1.1 | `system-directory-symlinked-<n>` |
| `schemes_queryable` and `schemes_found > 0` | 1.2 | `jailbreak-app-schemes-<n>` |
| `dyld_insert_libraries_set` | 1.2 | `dyld-insert-libraries-set` |

### 8.10 iOS: simulator, frida, mitm_attack, developer_tools, device_farm, vpn_mobile

**simulator.** Source `system`.

| Condition | Weight | Reason |
|---|---|---|
| `simulator_environment` non-empty | 1.5 | `simulator-environment-<n>-keys` |
| `simulator_build` | 1.5 | `built-for-simulator` |
| `sensors` ok, accelerometer and gyroscope false, not `mac` [proposed P2] | 0.9 | `no-motion-sensors` |
| `hardware.machine != hardware.uname_machine`, both present, not `mac` [proposed P2] | 0.8 | `uname-disagrees-with-machine` |
| `sources.attest.status == "unsupported"` | 0.5 | `no-device-attestation` |

**frida.** Source `instrumentation`.

| Condition | Weight | Reason |
|---|---|---|
| `library_hashes` meets the iOS library set | 1.6 | `instrumentation-image-<marker>` |
| `thread_hashes` meets the iOS thread set | 1.2 | `instrumentation-thread-<marker>` |
| `open_ports` non-empty | 1.1 | `frida-port-<first>-open` |
| `task_threads` is patched (8.11) | 1.4 | `thread-enumeration-hooked` |

**mitm_attack.**

| Condition | Weight | Reason |
|---|---|---|
| `tls` ok, a cert in `chain_subject_tokens` meets the interceptor set | 1.8 | `interception-ca-<marker>` |
| `tls` ok, `system_trusted == false` | 1.5 | `chain-not-system-trusted` |
| `tls` ok, `chain_length` is 1 or 2 | 0.7 | `chain-length-<n>` |
| `tls` ok, `handshake_failed` [proposed P5], or `sources.tls.status == "blocked"` | 0.3, once | `tls-probe-failed` |
| chain evidence, `network` ok, `proxy_configured` | 0.9 | `system-http-proxy-configured` |
| chain evidence, `network` ok, `proxy_auto_config` | 0.6 | `proxy-auto-config-set` |

Chain evidence here is an interceptor token, `system_trusted == false`, `chain_length` of 1 or 2, or `handshake_failed` (not a blocked probe,
which says nothing about the chain). The rule is Android's: a proxy or PAC file on an ordinary chain is a managed device.

**developer_tools.** Source `debugger`.

| Condition | Weight | Reason |
|---|---|---|
| `traced` | 1.6 | `process-is-traced` |
| `instrumentation` ok, `library_hashes` meets the iOS automation set | 1.5 | `test-runner-image-<marker>` |
| `automation_environment` has keys starting `XC`, count them | 1.2 | `test-runner-environment-<n>` |
| `parent_is_launchd == false` | 0.6 | `parent-is-not-launchd` |
| `debug_build` | 0.4 | `debug-configuration-build` |

**device_farm.** Silent when `security`, `accessibility` and `storage` are all not ok. `[proposed P1]`: the same cap as Android. iOS has no raw facts for
the disk or the boot, so facts are fewer by the store rules.

| Kind | Condition | Weight | Reason |
|---|---|---|---|
| fact | `network.transport == "wired"`, not `mac` [proposed P2] | 0.9 | `wired-ethernet-on-handset` |
| fact | `identity.launches > 20`, `install_age_h == 0` [proposed P4] | 1.0 | `launch-rate-<n>-in-under-an-hour` |
| circumstantial | `security.passcode_set == false` | 0.8 | `no-passcode-set` |
| circumstantial | `biometry_reason == "not-enrolled"` | 0.6 | `biometry-hardware-unenrolled` |
| circumstantial | `accessibility.settings_changed == 0` | 0.6 | `no-settings-ever-changed` |
| circumstantial | `battery.state` charging or full, `level >= 95` | 0.4 | `battery-full-and-charging` |
| circumstantial | `radio_services == 0`, `transport != "cellular"` | 0.25 | `no-cellular-service` |
| circumstantial | `fonts.count > 0` and `<= 60` | 0.4 | `stock-font-set-only` |

Today iOS sums all of these freely. The font rule is inert in practice, because a stock iPhone reports about 80 families.

Since iOS ADR 0001 the iOS SDK no longer sends `accessibility.settings_changed`, `battery.*` or `fonts.count`: those
sources are retired stubs (`unsupported`, reason `retired`), so the three tells above never fire on a current iOS report.
The remaining circumstantial tells still reach the cap. `unsupported` with reason `retired` means "removed by design", not
"missing on this device"; no rule may read a retired source's status as evidence.

**vpn_mobile.** `network` ok, `interface_types` contains `other` and `cellular`. High confidence, reason `device-vpn-over-cellular`.

### 8.11 Tampering

Android, sources `integrity`, `identity`, `app`, and iOS, sources `integrity`, `app`. Both fire through the same table:

| Condition | Weight | Reason |
|---|---|---|
| iOS: `patched > 0` | `min(1.8, 0.9 + 0.3 * patched)` | `patched-natives-<n>` |
| `hooked > 0` | `min(1.6, 0.8 + 0.25 * hooked)` | Android `hooked-methods-<n>`, iOS `swizzled-methods-<n>` |
| `injected > 0` (8.12) | 0.9 | `injected-libraries-<n>` (Android), `injected-images-<n>` (iOS) |
| each contradiction, in order, first 3 (8.12) | 0.8 each | `contradiction-<id>` |
| `missing > 0` (8.12) | 1.0 | `probe-suppressed-<n>` |
| Android: `identity.signature_changed` | 1.5 | `app-signature-changed-since-install` |
| Android: `app.signer_subject_tokens` has a set holding hash of `android` and of `debug` | 0.5 | `signed-with-debug-key` |
| Android: `app.sideloaded` | 0.3 | `installed-outside-a-store` |
| iOS: `app.is_app_bundle` and `has_code_signature == false` | 1.2 | `no-code-signature-directory` |
| iOS: `app.development_profile` and `has_receipt == false` | 0.7 | `development-build-without-receipt` |
| `schema` absent or not an integer | 1.5 | `report-schema-missing` |
| `schema` below 2 | 1.5 | `report-schema-outdated` |
| `n` required sources omitted (see below) | `min(2.0, 1.25 + 0.25 * (n - 1))` | `required-sources-omitted-<n>` |
| Android: `integrity.native_methods` missing, empty, or an entry with `declared <= 0` | 1.25 | `missing-native-methods` |
| iOS: `integrity` missing, or `native_symbols` or `objc_methods` missing or empty | 1.25 | `missing-integrity-probes` |
| `n` watched names with no entry or listed in `integrity.unresolved`, when the tables are there | `min(1.25, 0.25 * n)` | `watchlist-incomplete` |
| Android: `root.stat_access_mismatch` | 1.25 | `stat-access-mismatch` |
| Android: `root.listing_mismatch` | 1.25 | `listing-mismatch` |
| `library_hashes` over 768 entries, or `thread_hashes` over 128 | 1.5 | `hash-list-over-cap` |
| `library_hashes` exactly 768 entries | 0.15 | `library-list-at-cap` |

**Omitted.** The fast tier's source ids, the deferred tier's when `tiers` claims it (or does not say), and `integrity`. A required source is
absent, or counted absent, when it is missing, has an unknown status, or is `ok` without an object value; an integrity probe
(Android `root`, `emulator`, `debugger`, `instrumentation`, `cloned`; iOS `jailbreak`, `debugger`, `instrumentation`) also when `ok` with an
empty object, because a real probe always sends its lists even when empty. An ordinary source may be an empty object: a field that could not
be read is omitted.

**Failed security sources are `report_incomplete`, not tampering.** The signal `report_incomplete` (weight 16;
`detectNativeReportIncomplete`, `domain/risk/native_report.go`) fires when a required security source is missing or did not
finish: Android `root`, `instrumentation`, `emulator`, `debugger`, `cloned` and `tls`, iOS `jailbreak`, `instrumentation`,
`debugger` and `tls`. A source counts when it is absent in the sense above, or its status is `timeout`, `error` or `blocked`;
`unsupported` is not a failure. `tls` is required only when `tiers` claims the deferred tier or does not say. One such source
is medium confidence and two or more are high, reason `security-source-missing-<n>` when any was missing, else
`security-source-failed-<n>`. With no failed security source, three or more missing required sources (fast tier, and deferred
except `attest`) fire it at high confidence, reason `missing-required-sources`. The rule reads presence and status only, and
never runs for a report whose `schema` is missing or below 2 (that is tampering, above). Nothing the client says about time
excuses a failed or missing security source: a source's `ms`, `budget_ms` and `elapsed_ms` are numbers the client writes, so
a slow honest device whose probes run out of budget reports them as `timeout` and is scored for it. A failed probe inside a
source that ran is `probe_errors` (section 1), not this rule.

**Hash lists.** An SDK stops at each cap, so a list past one is not a real report, and the server neither reads past the cap nor scans the
tail. Which hashes survive the cap is the SDK's decision (tree order, then ascending hash) and the server cannot see one it dropped; a
modified client can omit any hash without padding anything. The honest achievable claim is that an exactly-full list is weak evidence: at 0.15 it
cannot fire alone or with an ordinary debug build (0.8 total), and can only tip a finding already close, such as `injected-libraries-1` at 0.9.
The real Android fixture (521 hashes; the 0.1.0 capture had 487) and any list under the cap are untouched.

Android `hooked` = sum of `native_methods[].native`. iOS `hooked` = entries of `objc_methods` whose `tree` is not `usr_lib`, `system_library`, `library_apple` or `sim_root`.

iOS `patched` counts `native_symbols` entries where:

1. `tree` is not one of those four system trees: patched, reason form `<image>!<symbol>`; or
2. a system-tree entry whose `prologue` decodes as patched. Read the first two little-endian 32-bit words, `w0`, `w1`:
   - trampoline: `w0 & 0xFF000000 == 0x58000000`, `w1 & 0xFFFFFC1F == 0xD61F0000`, `w0 & 0x1F == (w1 >> 5) & 0x1F`, register 16 or 17; or
   - branch: `w0 & 0xFC000000 == 0x14000000` and either `branch_resolved == false`, or `branch_image` differs from the entry's `image`.

`task_threads is patched` (8.10) = `native_symbols` has a patched entry for symbol `task_threads`.

The debug-key and sideload weights are capped so a debug build over adb (0.8 total) cannot fire tampering. The Android `tampering` fallback to
`integrity.patched_natives` and `lies` in `observeNative` is removed.

### 8.12 Contradictions, injected and missing (computed by the server)

**Android.** `rootLooksClean`: `root` ok, `su_paths`, `framework_paths` and `writable_system` present and empty (an absent
list is unknown, not clean), `mounts_truncated` and `listing_mismatch` not true, and `mountAnomalies == 0`.

Emit in this order (first three contradictions count):

| Id | Kind | Condition |
|---|---|---|
| `root.clean-with-injected-agent` | contradiction | `rootLooksClean`, library marker hit |
| `root.clean-with-hook-framework` | contradiction | `rootLooksClean`, `hook_classes` non-empty |
| `images.foreign-with-clean-filesystem` | injected | `rootLooksClean`, `exec_regions.file_other > 0` |
| `root.permissive-selinux-on-verified-boot` | contradiction | `selinux_enforcing == false`, `verified_boot_state == "green"` |
| `root.su-on-locked-bootloader` | contradiction | `su_paths` non-empty, `boot_locked == true` |
| `root.probe-blocked` | missing | `sources.root.status == "blocked"` |
| `emulator.virtual-board-on-retail-build` | contradiction | `emulator` ok, virtual board matched, `buildTokens` none |

**iOS.** `jailbreakClean`: `jailbreak` ok, `managers_found == 0`, `artefacts_found == 0`, `injectors` empty, `rootless_prefix_present` not true.
`simulator`: `simulator_build` or `simulator_environment` non-empty.

| Id | Kind | Condition |
|---|---|---|
| `jailbreak.clean-with-injected-image` | contradiction | `jailbreakClean`, iOS library marker hit |
| `images.foreign-with-clean-filesystem` | injected | `jailbreakClean`, `image_trees.other > 0` |
| `jailbreak.probe-blocked` | missing | `sources.jailbreak.status == "blocked"` |
| `sensors.absent-on-claimed-device` | contradiction | accelerometer and gyroscope false, not `simulator`, not `mac` [proposed P2] |
| `hardware.machine-disagrees-with-uname` | contradiction | not `simulator`, not `mac` [proposed P2], both present and differ |

**engine (for reference; nothing reads it on native).** Android: `claimed` = manufacturer and model; `observed` = `emulator` when a virtual board matched, `qemu_devices` or
`qemu_props` is non-empty, else `device` when `emulator` is ok; `agrees` = `(observed == "emulator") == (buildTokens hit)`.
iOS: `claimed` = `hardware.machine`; `observed` = `simulator` when `simulator` above holds or all three motion sensors are false, `device` when sensors are ok;
`agrees` = `(observed == "simulator") == simulator`. Silent when either side is unknown.

### 8.13 Server-held constants

Marker strings, in the clear, digested with `nameDigest` for both platforms: under the zero salt at start-up and under each
project's salt, cached (section 1.4). A list hits when any marker's digest, under the salt the report's `digest_salt_id`
names, is in the array.

Android library set: `frida`, `libfrida`, `fridagadget`, `xposed`, `libxposed`, `lsposed`, `liblsposed`, `edxposed`, `libedxposed`, `riru`, `libriru`, `libriruhide`,
`libriruloader`, `zygisk`, `libzygisk`, `zygiskloader`, `substrate`, `libsubstrate`, `shadowhook`, `libshadowhook`, `sandhook`, `libsandhook`, `yahfa`, `libyahfa`, `libwhale`,
`libepic`, `dobby`, `libdobby`.

Android thread set (exact names): `gmain`, `gdbus`, `gum-js-loop`, `pool-frida`, `pool-spawner`, `linjector`, `frida-helper`.

iOS library set: `frida`, `libfrida`, `fridagadget`, `libgum`, `gumjs`, `cynject`, `cycript`, `libcycript`, `substrate`, `libsubstrate`, `cydiasubstrate`, `mobilesubstrate`, `substitute`,
`libsubstitute`, `libhooker`, `ellekit`, `libellekit`, `tweakinject`, `libblackjack`, `rocketbootstrap`, `librocketbootstrap`, and the whole leaf names `gadget.dylib`, `shadow.dylib`.

iOS automation set: `xctest`, `xctestcore`, `xctautomationsupport`, `webdriveragent`, `webdriveragentlib`, `webdriveragentrunner`, `testbundleinject`, `libxctestbundleinject`, `libxctestswiftsupport`.

iOS thread set: `gmain`, `gdbus`, `gum-js-loop`, `pool-frida`, `linjector`, and token `frida` for today's prefix test.

Interceptor set (a cert hits on any single token, or on both tokens of a pair). Android and iOS: `mitmproxy`, `charles`, `burp`, `fiddler`, `httptoolkit`, `proxyman`, `reqable`, `bettercap`, pair `owasp zap`, pair
`packet capture`. Android only: `portswigger`, `zaproxy`. iOS only: pair `http toolkit`, `sslsplit`, `netfox`, `surge`, `stream`.

`virtualBoards` (exact): `goldfish`, `ranchu`, `vbox86`, `nox`, `ttvm_x86`, `andy`, `droid4x`, `microvirt`, `vsoc`, `cutf_cvm`, `gce_x86`, `cuttlefish`.

`buildTokens` (substring, except `*` whole tokens): `sdk_gphone`, `sdk_google`, `google_sdk`, `android sdk built for`, `emulator`, `vbox86`, `genymotion`, `bluestacks`, `ldplayer`, `droid4x`, `microvirt`, `ttvm`*, `cuttlefish`, `goldfish`, `ranchu`, `nox`*, `andy`*, `vsoc`*.

`virtualCpus` (substring, except `*` whole tokens): `goldfish`, `ranchu`, `virtual`*, `intel emulator`, `qemu`*.

A whole token has a non-alphanumeric byte or the end of the string on each side (underscore counts, as in `nox_x86`). Short markers and ordinary words are whole tokens because a model or brand name is free text: `andy` is inside Brandy and Handy, `nox` inside ordinary model names. The platform sensor vendor test in 8.2 reads `aosp` the same way.

## 9. Platform differences and proposed fixes

### Deliberate differences

| Area | Android | iOS | Why |
|---|---|---|---|
| Chain length rule | `== 1` | 1 or 2 | Android reads the chain the server sent (leaf and intermediate, so 2 is normal). iOS reads the evaluated path, which includes the root, so a proxy-signed chain is 2 and a real one 3 |
| User CA count | counted (0.95) | none | iOS has no API for the trust store |
| Farm evidence | setup fact; empty disk and recent boot are circumstantial | none of these | iOS required-reason APIs forbid disk and boot leaving the device |
| Settings count | raw values, server counts | client count | iOS flags name disabilities; Android's values do not |
| Tamper anchor | signature history | code signature and receipt | what each platform exposes |
| Cloner | present | none | no iOS equivalent |
| Developer tools weight | 8 | 16 | `weights.go`, a customer setting, not a detector |
| Interceptor match | every cert, subject and issuer | leaf and root subject summary | what the public API returns |

### Proposed fixes (the port implements them; each is one table row to revert)

- **P1. iOS farm circumstantial cap.** Android's cap is absent on iOS, where no passcode (0.8) and untouched settings (0.6) alone fire `device_farm`.
- **P2. iOS gate for Macs** (equivalent of Android's `form_factor`). An iOS app on a Mac has no motion sensors and `hw.machine` differs from `uname`: today that fires two contradictions and reports tampering. Gate those, and the wired-ethernet rule, on `mac`.
- **P3. iOS `launches` once per process.** Android fixed this; iOS still adds one on every identify, so an app calling identify 21 times in its first hour fires `launch-rate` alone.
- **P4. iOS `install_age_h` not clamped, rule `== 0`.** iOS clamps to 0 and tests `< 1`, so a clock set back reads as a brand-new install. Android fixed this.
- **P5. iOS TLS.** Copy the chain after `SecTrustEvaluateWithError`, so `chain_length` means the evaluated path; before evaluation it may be the two certificates sent, firing 0.7 on every report. And report a failed handshake as a value (`handshake_failed: true` with whatever was captured), status `ok`, as Android does. Today a failed trust throws, so `chain-not-system-trusted` can never fire.
- **P6. Android root on an emulator** (the reverse direction, from iOS's simulator rule). A stock emulator image with test keys and `ro.debuggable=1` sums to 1.2 and reports root. When `emulatorHard` holds, those two build-type tells do not count. Real `su` and framework tells still do.

Android fixes with no iOS counterpart to port: ADB and developer options counted once (iOS has neither setting); telephony 0.05 (iOS uses radio services, 0.25, and is capped by P1); user CA at 0.95 (not measurable on iOS).

## 10. What cannot be fully reproduced on the server

- **Library and image markers.** Today's matchers are substring tests; a hash can only match exactly. Token expansion recovers versioned and suffixed names. A name that hides the marker with no separator (`myfridalib.so`) is missed, and so is any token not in the server's list. Renaming defeats both forms; the thread, port, hook-class and memory-region rules remain.
- **Android non-executable mappings.** A marker only in a non-executable mapping, such as `XposedBridge.jar` alone, is no longer seen. `hook_classes` covers that case.
- **`Build.HOST` tokens.** The host is sent only as a digest, because it is the builder's machine name. Host-only matches are dropped deliberately; they were the `andy` and `nox` false-positive surface on custom ROMs.
- **iOS thread prefix.** A thread `frida...` with no separator after `frida` is missed; `frida-...` is caught.
- **Reason detail.** Rules that named the first file found (`package-manager-<leaf>`, `jailbreak-artefact-<leaf>`) now carry counts, because the names cannot leave. Weights are unaffected.
- **Client measurements the server must accept as read:** the section 5 fields. It can stop trusting them but cannot recompute them.

## 11. v3 HTTP Envelope and Raw-Byte Attestation Binding

In the `v: 3` wire protocol ([v3-envelope.md](./v3-envelope.md)), the `schema: 2` native report defined in sections 2 and 3 is serialized once to UTF-8 bytes (`signalsBytes`) and placed verbatim into the top-level `signals` field of `IdentifyIn` / `IngestIn`:

- **Top-level `AttestEnvelope`**: Cryptographic proofs move from in-report fields to top-level `attest` (`mode` in `{"android_key_register", "android_key_assert", "app_attest_register", "app_attest_assert"}`, stateless KMS-signed `challenge` ticket, `install_id`, `key_id`, iOS `attestation_object` / `assertion` / `device_token` / `device_token_write`, Android `certificate_chain` / `signature` / `prev_key_id` / `prev_signature`, and optional `play_integrity_token`).
- **Raw-byte signing**: Mobile clients compute `signalsDigest = SHA256(signalsBytes)` and sign `framedPreimage` (`statementDigest = SHA256(framedPreimage)`) covering the authenticated platform, `challenge` ticket ASCII string, `install_id`, `Idempotency-Key`, the digest of both DeviceCheck tokens, the envelope digest of `tag`, `sdk.platform`, `sdk.version`, `consent` and `attest.reattest_attempt` ([v3-envelope.md](./v3-envelope.md) section 3.2), and `signalsDigest` without cross-language JSON re-canonicalization. The server verifies the hardware signature and single-use ticket over exact `signals` wire bytes before JSON decoding, then checks `attest.install_id == sources.identity.value.install_id`.
- **1-RTT steady-state**: Every native `IdentifyOut` response carries `next_attestation` (`AttestationChallengeOut`). Whenever the request carried `attest`, it also carries `attest_key_id` (the `attest.key_id` the server evaluated) and `attest_key_status`: `registered`, `valid`, `rekey_required` or `rejected` ([v3-envelope.md](./v3-envelope.md) section 1.3). A native request without `attest` carries `attest_skipped` instead. `next_attestation` also carries the project's `digest_salt`, which keys every name digest of the next report (section 1.4). `sources.tls` reads `root_key_sha256` from the shared HTTPS transport cache rather than issuing a separate `HEAD /` probe.
