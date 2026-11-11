# Native raw report contract (Android and iOS)

The raw report the Android and iOS SDKs send so that the server can derive every detection. It is the
contract the Android, iOS and server work builds against in parallel.

Rule: a client collects and sends. No client holds a weight, a threshold, a verdict, a confidence or a
fraud conclusion. Everything in section 8 runs on the server and only there.

Native SDKs and bridges are unpublished, so nothing here needs backward compatibility.

## 1. Conventions

**Status words.** `unchanged`: same name, type and meaning as today. `new`: did not exist. `renamed`: same
measurement under a new name or type. `removed`: no longer sent.

**Absent is not false.** A field that could not be read is omitted (`jsonObject` already drops nulls on both
platforms). The server treats absent, null and wrong-typed values as "not known" (`risk/report.go`). Rules that
test `== false` do not fire on absent values. This is about fields inside a source. A source id is never absent from a
real report: see section 8.11.

**Default bounds.** Unless a table says otherwise: strings at most 256 bytes (truncate), integers are 32-bit
signed, doubles are finite. Every array has a cap in its table; a client stops at the cap, it does not fail.

**Envelope.** Unchanged shape: `{ schema, budget_ms, elapsed_ms, tiers, sources: { id: { status, ms, value?, reason? } }, integrity }`.
`schema` becomes `2` on both native platforms, because field meanings change. The server reads rules the same way whatever the
schema, but a native report that lacks `schema` or names one below `2` is tampering evidence (8.11): no native SDK ever sent anything
else, so a lower number is a report asking to be read by older rules.
A source is only read when `status == "ok"` (`sourceValue`), except the rules that test `status` directly.

**Every source id is always sent.** The set of keys never depends on how a run went: a source the budget never reached is
`{ status: "timeout", reason: "budget-exhausted", ms: 0 }`, and one that overran its own timeout is `timeout` with the time it took. So a
missing source id, or an `ok` with no object value, is never a slow device. It is evidence (8.11). `tiers` says which tiers ran, and only
the sources of a tier the report claims to have run are required; `fast` is always required.

**Status words** are `ok`, `unsupported`, `blocked`, `timeout` and `error`. Anything else is not a report a client wrote.

**Cohort safety.** `services/velocity.go` builds the velocity cohort from every *scalar* key of `hardware`,
`display` and `app`. So no new scalar goes in those three sources. New fields live elsewhere, or are arrays
(`scalarText` ignores arrays). No new field enters native identity, which stays `identity.install_id` only.

**Free text.** No names from outside system trees, no other app's name, no raw data directory, no installer
package, no accessibility service name. Where the raw value is free text it travels as `hash64`.

### 1.1 hash64

Sixteen lowercase hex characters: xxHash32 of the UTF-8 bytes with seed `0`, then with seed `0x9E3779B1`,
concatenated. Identical to `hash64` in the Android and iOS SDKs. **The server has no implementation today and
must add one.** Check it against these vectors:

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
5. Output the set `{ hash64(stem) } ∪ { hash64(t) for t in tokens }`.
6. iOS image names only: also add `hash64(leaf)`, with the extension. Two iOS markers are bound to the extension.

Why tokens and not only the whole name: today's library markers are substrings, and a hash can only match
exactly. `libfrida-gadget-16.5.2.so` has a new whole name every release, but always yields the token `libfrida`.

Examples: `libfrida-gadget-16.5.2.so` gives stem `libfrida-gadget-16.5.2`, tokens `libfrida`, `gadget`.
`memfd:frida-agent-64.so (deleted)` gives stem `frida-agent-64`, tokens `frida`, `agent`.
`libXposed_art.so` gives stem `libxposed_art`, tokens `libxposed`, `art`.

The server holds marker strings in the clear (section 8.13), hashes them at start-up, and tests set membership.

### 1.3 Types used below

- `hash64[]`: sorted ascending unless a rule below says otherwise; no duplicates.
- `TokenSets`: array of arrays of hash64. Each inner array is one `nameHashes` output, capped at 24 and sorted.
- `ImageRef` (iOS): for an image under a system tree (`usr_lib`, `system_library`, `system_applications`,
  `library_apple`, `sim_root`), the leaf file name as reported. For anything else, `hash64` of the lowercased
  leaf. Never a path.

## 2. Android report

Probe lists stay in the client (paths, package names, class names, ports). Lists that interpret a value already
read move to the server.

### identity (fast, essential)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `install_id` | string | UUID, 36 | unchanged |
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
| `kernel_digest` | hash64 | | unchanged |
| `build_id` | string | | unchanged |
| `build_type` | string | | unchanged |
| `build_tags` | string | | unchanged; now the only input for `test_keys` |
| `build_host_digest` | hash64 | | unchanged |
| `build_user_digest` | hash64 | | unchanged |
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

### display (fast; in the velocity cohort)

| Field | Type | Status |
|---|---|---|
| `width`, `height`, `density_dpi`, `x_dpi`, `y_dpi`, `refresh_hz` | int | unchanged |
| `density` | double | unchanged |

### storage (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `total_gb`, `available_gb` | int | | unchanged |
| `free_ratio` | double | 0 to 1, 2 decimals | unchanged |
| `app_dir_entries` | int | | unchanged |
| `external_emulated` | bool | | unchanged |

### intl (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `timezone` | string | IANA | unchanged |
| `utc_offset_min` | int | | unchanged |
| `dst` | bool | | unchanged |
| `locale` | string | BCP 47 | unchanged |
| `locales` | string[] | at most 8 | unchanged |
| `uses_24h` | bool | | unchanged |

### accessibility (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `font_scale`, `animator_scale`, `transition_scale`, `window_scale` | double | | unchanged |
| `screen_off_timeout_s` | int | absent when never sleeps | unchanged |
| `screen_never_sleeps` | bool | | unchanged |
| `any_service_enabled` | bool | yes or no, never a count or a name | new |
| `settings_changed` | int | | removed (server derives it, 8.7) |

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
| `biometry_unusable` | bool | | removed (hardware present and no lockscreen, derived) |

### sensors (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `count` | int | | unchanged |
| `vendors` | string[] | at most 6, each at most 64 | unchanged |
| `accelerometer`, `gyroscope`, `magnetometer`, `proximity`, `light`, `pressure`, `step_counter`, `heart_rate` | bool | | unchanged |

### audio (fast)

| Field | Type | Status |
|---|---|---|
| `output_sample_rate`, `output_frames_per_buffer`, `max_music_volume` | int | unchanged |
| `supports_low_latency`, `supports_pro`, `music_active` | bool | unchanged |

### network (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `transport` | string | ethernet, wifi, cellular, bluetooth, vpn | unchanged |
| `underlying_transports` | string[] | at most 5 | unchanged |
| `tunnel_interfaces` | string[] | at most 8, each at most 16 | unchanged |
| `proxy_configured` | bool | | unchanged |
| `sim_absent` | bool | | unchanged |
| `metered` | bool | | unchanged |
| `tunnelled` | bool | | removed (`underlying_transports` contains `vpn`) |

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
| `signer_subject_tokens` | TokenSets | at most 4 signers; `nameHashes` of each subject DN | new (array, so outside the cohort) |
| `debug_signed` | bool | | removed (server tests the tokens) |

### root (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `su_paths` | string[] | at most 10, probe paths only | unchanged |
| `su_on_path` | bool | | unchanged |
| `busybox_paths` | string[] | at most 10, probe paths only | unchanged |
| `framework_paths` | string[] | at most 13, probe paths only | unchanged |
| `root_manager_installed`, `hook_manager_installed` | bool | aggregate, see section 5 | unchanged |
| `writable_system` | string[] | at most 7, probe paths only | unchanged |
| `selinux_enforcing` | bool | | unchanged |
| `selinux_context` | string | at most 64, category suffix removed | unchanged |
| `verified_boot_state` | string | at most 16, lowercased | unchanged |
| `boot_locked` | bool | | unchanged |
| `verity_mode` | string | at most 32 | unchanged |
| `boot_properties` | string[] | at most 4 | unchanged |
| `ro_debuggable` | string | raw value, at most 8 | new |
| `ro_secure` | string | raw value, at most 8 | new |
| `system_mounts` | object[] | at most 8; see below | new |
| `mount_framework_lines` | int | 0 to 1024; see below | new |
| `mount_anomalies` | string[] | | removed |
| `dangerous_props` | string[] | | removed |
| `test_keys` | bool | | removed (`system.build_tags` contains `test-keys`) |

`system_mounts`: one entry per `/proc/self/mounts` line whose mount point is exactly `/system`, `/vendor`,
`/product` or `/system_ext`. Each is `{ "point": string, "type": string (at most 16), "rw": bool }`, where `rw` means the
options field starts with `rw`. These four points and the filesystem type are not free text.

`mount_framework_lines`: how many mount lines have a source or point containing `magisk` (any case) or a point
starting with `/data/adb`. A count because the rest of the table can name other apps (section 5).

### emulator (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `qemu_props` | string[] | at most 6, probe names | unchanged |
| `qemu_devices` | string[] | at most 9, probe paths | unchanged |
| `emulator_files` | string[] | at most 17, probe paths | unchanged |
| `telephony` | bool | | unchanged |
| `ro_hardware` | string | raw `ro.hardware`, at most 64 | new |
| `features` | object | see below; absent when the package manager fails | new |
| `virtual_board` | string | | removed |
| `build_indicators` | string[] | | removed |
| `cpu_hardware` | string | | removed (`hardware.cpu_hardware`) |
| `x86_abi` | bool | | removed (`hardware.abis`) |
| `form_factor` | string | | removed (`features`) |

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
| `hook_classes` | string[] | at most 6, probe classes | unchanged |
| `foreign_stack_frames` | bool | | unchanged |
| `open_ports` | int[] | at most 2 | unchanged |
| `artefacts` | string[] | at most 4, probe paths | unchanged |
| `library_hashes` | hash64[] | at most 768; see below | new |
| `library_total` | int | distinct names before the cap | new |
| `thread_hashes` | hash64[] | at most 128; `nameHashes` of each thread name, sorted | new |
| `thread_total` | int | distinct thread names before the cap | new |
| `exec_regions` | object | int counts; see below | new |
| `libraries` | string[] | | removed |
| `threads` | string[] | | removed |
| `anonymous_exec_maps` | int | | removed |

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
| `data_dir_expected`, `data_dir_in_other_app`, `stub_process_name`, `cloner_installed` | bool | see section 5 | unchanged |
| `foreign_sandbox_maps` | int | count, never names | unchanged |
| `user_id` | int | | unchanged |
| `oem_clone` | bool | | removed (`user_id == 999`) |

### images (deferred)

| Field | Type | Status |
|---|---|---|
| `count` | int | unchanged |
| `digest` | hash64 | unchanged |
| `executable_regions` | int | unchanged |
| `foreign`, `foreign_count` | | removed (`instrumentation.exec_regions.file_other`, on the fast tier) |

### attest (deferred)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `chain` | string[] | base64 certs, at most 32 KiB decoded | unchanged |
| `chain_length`, `chain_carried` | int | | unchanged |
| `challenge` | string | base64 | unchanged |
| `challenge_source` | string | server or device | unchanged |
| `secure_hardware` | bool | | unchanged |
| `security_level` | string | at most 32 | unchanged |
| `software_rooted` | bool | | removed (`chain_length <= 1`) |

Challenge flow: the SDK requests a nonce from `POST /api/v1/attestation/challenge` (32 random bytes, five minutes,
single use, bound to the SDK key), has the hardware keystore attest a fresh key to it, and sends the chain with
`challenge` and `challenge_source: "server"`. If the request fails, the SDK generates a nonce and sends
`challenge_source: "device"`; such a chain is never treated as proven. The chain is forwarded verbatim and only the
server reads what is inside it: the server checks it against the published roots, the application ID in the extension
against the report and the key's `allowed_android_packages` and `allowed_android_signers`, and spends the challenge.

### tls (deferred)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `user_ca_count` | int | | unchanged |
| `probe_skipped` | bool | | unchanged |
| `handshake_failed` | bool | | unchanged |
| `failure` | string | at most 64, class name only | unchanged |
| `chain_length` | int | | unchanged |
| `system_trusted` | bool | | unchanged |
| `root_digest` | hash64 | | unchanged |
| `leaf_expires_at` | int | epoch seconds | unchanged |
| `chain_subject_tokens` | TokenSets | at most 6 certs, leaf first; `nameHashes` of subject and issuer DN joined by a space | new |
| `known_interceptor` | string | | removed |

### integrity

| Field | Type | Bounds | Status |
|---|---|---|---|
| `native_methods` | object[] | at most 8, see below | new |
| `patched_natives` | string[] | always empty on Android | removed |
| `lies` | object[] | | removed (server derives, 8.12) |
| `engine` | object | | removed (server derives, 8.12) |

`native_methods`: one entry per watched method present on this OS. `{ "method": "java.io.File!exists", "declared": int, "native": int }`:
how many overloads were checked and how many report `Modifier.isNative`. A method absent from the OS has no entry.

### device

Removed entirely. See section 6.

## 3. iOS report

### system (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `os_version`, `os_build`, `os_type`, `uname_release` | string | | unchanged |
| `kernel_version` | hash64 | | unchanged |
| `simulator_model`, `simulator_runtime` | string | | unchanged |
| `simulator_environment` | string[] | at most 5, key names only | unchanged |
| `simulator_build` | bool | | unchanged |
| `active_processors` | int | sent only on a simulator (iOS ADR 0001) | unchanged |
| `low_power_mode` | bool | | removed (iOS ADR 0001) |

### hardware (fast; in the velocity cohort)

| Field | Type | Status |
|---|---|---|
| `machine`, `uname_machine`, `model`, `target`, `product` | string | unchanged |
| `memory_bytes` | int64 | removed (iOS ADR 0001) |
| `physical_cpu`, `logical_cpu`, `cpu_family`, `cpu_subfamily`, `cacheline`, `l1d_cache`, `l1i_cache`, `l2_cache`, `page_size`, `byte_order` | int | removed (iOS ADR 0001) |

### display (fast; in the velocity cohort)

| Field | Type | Status |
|---|---|---|
| `width`, `height`, `native_width`, `native_height` | int | unchanged |
| `scale`, `native_scale` | double | unchanged |
| `max_fps` | int | removed (iOS ADR 0001) |
| `brightness` | double | removed (iOS ADR 0001) |
| `gamut`, `interface_style` | string | removed (iOS ADR 0001) |

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
| `apple_locale`, `region`, `calendar`, `currency`, `decimal_separator` | string | | removed (iOS ADR 0001) |
| `utc_offset_s`, `first_weekday` | int | | removed (iOS ADR 0001) |
| `is_dst`, `uses_24_hour`, `uses_metric` | bool | | removed (iOS ADR 0001) |
| `languages` | string[] | at most 6 | removed (iOS ADR 0001) |

### accessibility (fast)

Retired (iOS ADR 0001). The id is still sent, as `{ status: "unsupported", reason: "retired" }` with no value, so that
section 8.11 does not read it as omitted. No API is called.

| Field | Type | Status |
|---|---|---|
| `settings_changed` | int | removed (iOS ADR 0001) |
| `default_text_size` | bool | removed (iOS ADR 0001) |

### battery (fast)

Retired (iOS ADR 0001), sent as `unsupported` with reason `retired` and no value.

| Field | Type | Bounds | Status |
|---|---|---|---|
| `level` | int | 0 to 100, step 5 | removed (iOS ADR 0001) |
| `state` | string | charging, full, unplugged, unknown | removed (iOS ADR 0001) |
| `low_power_mode` | bool | | removed (iOS ADR 0001) |
| `thermal_state` | string | | removed (iOS ADR 0001) |

### security (fast)

| Field | Type | Status |
|---|---|---|
| `passcode_set` | bool | unchanged |
| `biometry_reason` | string | unchanged |
| `biometry_enrolled` | bool | removed (iOS ADR 0001; an absent `biometry_reason` says it) |
| `biometry_type` | string | removed (iOS ADR 0001) |

### sensors (fast)

| Field | Type | Status |
|---|---|---|
| `accelerometer`, `gyroscope` | bool | unchanged |
| `magnetometer`, `device_motion` | bool | removed (iOS ADR 0001) |

### audio (fast)

Retired (iOS ADR 0001), sent as `unsupported` with reason `retired` and no value.

| Field | Type | Bounds | Status |
|---|---|---|---|
| `outputs`, `inputs` | string[] | at most 8 | removed (iOS ADR 0001) |
| `output_channels` | int | | removed (iOS ADR 0001) |
| `other_audio_playing` | bool | | removed (iOS ADR 0001) |

### network (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `radio_services` | int | | unchanged |
| `proxy_configured`, `proxy_auto_config` | bool | | unchanged |
| `transport` | string | wifi, cellular, wired | unchanged |
| `interface_types` | string[] | at most 5 | unchanged |
| `interfaces` | string[] | at most 32, each at most 16 | removed (iOS ADR 0001) |
| `tunnels`, `scoped_tunnels` | string[] | at most 16 | removed (iOS ADR 0001) |
| `tunnel_count` | int | | removed (iOS ADR 0001) |
| `path_status` | string | | removed (iOS ADR 0001) |
| `expensive`, `constrained`, `supports_ipv4`, `supports_ipv6` | bool | | removed (iOS ADR 0001) |
| `radio` | string[] | at most 4 | removed (iOS ADR 0001) |
| `tunnelled` | bool | | removed (`interface_types` contains `other`) |

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
| `first_seen_at` | int | epoch seconds | removed (iOS ADR 0001) |
| `launches` | int | >= 1 | unchanged; meaning changes to once per process (P3) |
| `install_age_h` | int | may be negative after P4 | unchanged; stop clamping to 0 (P4) |
| `reinstalled` | bool | see section 5 | removed (iOS ADR 0001: the install record lives in the app container by default, and the vendor identifier is no longer read) |

### jailbreak (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `injectors` | string[] | at most 10, probe paths | unchanged |
| `userland` | string[] | at most 10, probe paths | unchanged |
| `symlinked_directories` | string[] | at most 8, probe paths | removed (iOS ADR 0001: `readlink` reads outside the container, Guideline 2.5.2) |
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
| `automation_images` | string[] | | removed (`instrumentation.library_hashes`) |

### instrumentation (fast)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `thread_count` | int | | unchanged |
| `open_ports` | int[] | at most 2 | unchanged |
| `library_hashes` | hash64[] | at most 768; see below | new |
| `library_total` | int | images considered before the cap | new |
| `thread_hashes` | hash64[] | at most 128; `nameHashes` of each thread name, sorted | new |
| `thread_total` | int | distinct thread names before the cap | new |
| `app_image_hashes` | hash64[] | at most 128; `hash64` of the lowercased path of each image inside the app, relative to the container (`@app/...`), sorted | new |
| `image_trees` | object | int counts by tree; see below | new |
| `images` | string[] | | removed |
| `threads` | string[] | | removed |

`library_hashes`: for every loaded image whose tree is not `system_library` or `sim_root` (those trees are the bulk of a real
app's images and are not where an injected library lives): `nameHashes` of the leaf, plus `nameHashes` of the name of its
immediate parent directory. The parent is there because today's match runs on the whole path, and every tweak lives under a
telling directory (`/Library/MobileSubstrate/DynamicLibraries/x.dylib`, `/usr/lib/TweakInject/x.dylib`). When over the cap,
take trees `other`, `app_bundle`, `app_parent` and `loaded_bundle` first, then the rest; inside each group ascending by hash.
Sort the final list.

`image_trees` counts all loaded images, first match wins. Trees: `sim_root` (prefix is the value of `SIMULATOR_ROOT`,
`DYLD_ROOT_PATH` or `IPHONE_SIMULATOR_ROOT`), `usr_lib` (`/usr/lib/`), `system_library` (`/System/Library/`),
`system_applications` (`/System/Applications/`), `library_apple` (`/Library/Apple/`), `app_bundle` (main bundle path),
`app_parent` (the bundle's parent directory), `loaded_bundle` (any `Bundle.allBundles` path), `other`.

### images (fast)

| Field | Type | Status |
|---|---|---|
| `count` | int | unchanged |
| `digest` | hash64 | unchanged |
| `foreign` | string[] | removed; it sent full paths in the clear |
| `foreign_count` | int | removed (`instrumentation.image_trees.other`) |

### fonts (deferred)

Retired (iOS ADR 0001), sent as `unsupported` with reason `retired` and no value.

| Field | Type | Status |
|---|---|---|
| `count` | int | removed (iOS ADR 0001) |

### attest (deferred)

| Field | Type | Status |
|---|---|---|
| `devicecheck_supported`, `app_attest_supported` | bool | unchanged |
| `device_token` | string | unchanged; still switched off |
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

### tls (deferred)

| Field | Type | Bounds | Status |
|---|---|---|---|
| `chain_length` | int | after trust evaluation (P5) | unchanged |
| `root_key_sha256` | string | base64 | unchanged |
| `system_trusted` | bool | | unchanged |
| `clock_skew_s` | int | | unchanged |
| `handshake_failed` | bool | P5 | new |
| `chain_subject_tokens` | TokenSets | exactly leaf then root, at most 2; `nameHashes` of `SecCertificateCopySubjectSummary` | new |
| `leaf_subject`, `root_subject` | string | | removed (free text naming an employer's CA) |
| `known_interceptor` | string | | removed |

### integrity

| Field | Type | Bounds | Status |
|---|---|---|---|
| `native_symbols` | object[] | at most 16; see below | new |
| `objc_methods` | object[] | at most 12; see below | new |
| `patched_natives` | string[] | | removed |
| `lies` | object[] | | removed |
| `engine` | object | | removed |

`native_symbols`: one entry per watched function that `dlsym` resolves and `dladdr` places:
`{ "symbol": string, "image": ImageRef, "tree": string, "prologue": string?, "branch_image": ImageRef?, "branch_resolved": bool? }`.
`tree` uses the `image_trees` vocabulary. `prologue` is the 16 bytes at `dli_saddr` as 32 hex characters, read with
`vm_read_overwrite`, sent only when `tree` is `usr_lib`, `system_library`, `library_apple` or `sim_root` and the read succeeded.
`branch_resolved` and `branch_image` are sent only when the first instruction is `B imm26` (top six bits `000101`):
whether `dladdr` placed the target, and which image it is. The client does the branch arithmetic because the server has no
address map. Nothing here needs a private API, and system bytes are the same on every device on one OS build.

`objc_methods`: one entry per watched method that resolves: `{ "method": "NSFileManager fileExistsAtPath:", "image": ImageRef?, "tree": string }`,
with `tree` set to `unresolved` when `dladdr` cannot place the implementation.

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

Each is a measurement of a raw value the store rules forbid sending. None says what the device is.

| Field | Platform | What it measures | Why the raw value cannot leave |
|---|---|---|---|
| `root_manager_installed`, `hook_manager_installed` | Android | a lookup on a fixed package list answered yes | other apps appear only as yes or no (Play User Data) |
| `cloner_installed` | Android | the same | the same |
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

The ingest routes refuse a body over 1 MiB (`DefaultMaxBodySize`). Today a report is about 5 KB of JSON. One hash costs 19 bytes.

| | Android typical | Android at every cap | iOS typical | iOS at every cap |
|---|---|---|---|---|
| `library_hashes` | about 400 hashes, 7.6 KB | 14.6 KB | about 180 hashes, 3.4 KB | 14.6 KB |
| `thread_hashes` | 1.1 KB | 2.4 KB | 0.4 KB | 2.4 KB |
| chain and signer tokens | 0.8 KB | 4.6 KB | 0.4 KB | 0.9 KB |
| integrity tables, regions, mounts, features | 1.0 KB | 1.3 KB | 3.1 KB (with `app_image_hashes` and trees) | 5.5 KB |
| Removed (`device`, `lies`, `engine`, names) | minus 1 KB | minus 1 KB | minus 1 KB | minus 1 KB |
| **Net increase** | **about 9.5 KB** | **about 22 KB** | **about 6.5 KB** | **about 22 KB** |

So a typical report goes from about 5 KB to about 15 KB on Android and about 12 KB on iOS, roughly 6 KB and 4 KB gzipped (hex hashes
compress about 2 to 1). The worst case, with Android's 32 KiB attestation chain as base64, is about 70 KB: 7 percent of the limit.

These are estimates from the SDKs' own notes (two to four hundred distinct mapped files on a real Android app, a report of about five
kilobytes), not device measurements. The caps are what hold the worst case. Measure on real devices when the SDKs land.

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
| `verified_boot_state == "orange"` | 0.9 | `bootloader-unlocked` |
| `verified_boot_state == "yellow"` | 0.9 | `boot-image-self-signed` |
| `verified_boot_state == "red"` | 1.2 | `boot-verification-failed` |
| `system.build_tags` contains `test-keys`, and not `emulatorHard` [proposed P6] | 0.8 | `build-signed-with-test-keys` |
| `ro_debuggable == "1"` or `ro_secure == "0"`, once, and not `emulatorHard` [proposed P6] | 0.4 | `dangerous-prop-<first>` |
| `root_manager_installed` | 0.7 | `root-manager-installed` |
| else `hook_manager_installed` | 0.7 | `hook-manager-installed` |
| `busybox_paths` non-empty | 0.5 | `busybox-present` |
| `su_on_path` and `su_paths` empty | 1.2 | `su-on-path-but-not-stattable` |

`emulatorHard`: `emulator` ok and (`qemu_props` or `qemu_devices` non-empty, or a virtual board matched).

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
| `sensors.vendors` non-empty, all platform vendors | 1.1 | `all-sensors-vendored-by-the-os` |
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
| selective probe failure (see below) | 1.0 (low confidence alone) | `security-probes-failed-<n>` |
| `library_hashes` over 768 entries, or `thread_hashes` over 128 | 1.5 | `hash-list-over-cap` |
| `library_hashes` exactly 768 entries | 0.15 | `library-list-at-cap` |

**Omitted.** The fast tier's source ids, the deferred tier's when `tiers` claims it (or does not say), and `integrity`. A required source is
absent, or counted absent, when it is missing, has an unknown status, or is `ok` without an object value; an integrity probe
(Android `root`, `emulator`, `debugger`, `instrumentation`, `cloned`; iOS `jailbreak`, `debugger`, `instrumentation`) also when `ok` with an
empty object, because a real probe always sends its lists even when empty. An ordinary source may be an empty object: a field that could not
be read is omitted.

**Selective probe failure.** Android 4 of its 5 integrity probes, or iOS all 3, are `timeout`, `error` or `blocked`, on a run that still had
budget (`elapsed_ms` under 90 percent of `budget_ms`) and whose ordinary fast sources are at most half failed. One failed probe is not
evidence. The threshold is tuned from the real schedulers and fixtures so a slow genuine device stays quiet:

- Integrity probes run last in the fast queue, so a budget that runs out reaches all of them at once, as `budget-exhausted` timeouts at 0 ms,
  and the spent `elapsed_ms` excuses it. Forging the excuse costs a client one number, which is the price of not punishing a slow phone.
- Probe timeouts are generous (Android 200 to 600 ms, iOS 80 to 200 ms) against 0 to 301 ms in the real fixtures. Root, instrumentation and
  cloned read the same files, so three of them timing out is one slow disk; 4 of 5 also needs the unrelated emulator or debugger probe, and
  3 of 3 on iOS needs every probe, each under 30 ms in the fixture.
- A device stalled badly enough to fail the probes also fails its ordinary sources, and deferred failures are ordinary network behaviour, so
  neither counts.

**Hash lists.** An SDK stops at each cap, so a list past one is not a real report, and the server neither reads past the cap nor scans the
tail. Which hashes survive the cap is the SDK's decision (tree order, then ascending hash) and the server cannot see one it dropped; a
modified client can omit any hash without padding anything. The honest achievable claim is that an exactly-full list is weak evidence: at 0.15 it
cannot fire alone or with an ordinary debug build (0.8 total), and can only tip a finding already close, such as `injected-libraries-1` at 0.9.
The 487-hash real fixture and any list under the cap are untouched.

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

**Android.** `rootLooksClean`: `root` ok, `su_paths`, `framework_paths`, `writable_system` empty, and `mountAnomalies == 0`.

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

Marker strings, in the clear, hashed with `hash64` at start-up. A list hits when any marker's hash is in the array.

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
