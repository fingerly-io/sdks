# v3 Wire Envelope and Cryptographic Binding Contract

This specification defines the unified `v: 3` HTTP request and response wire contract across Web, iOS, Android, mobile framework bridges, first-party proxies, and the Go verification server (`POST /api/v1/ingest` and `POST /api/v1/identify`). Machine-readable constants and deterministic SHA-256 test vectors live alongside this document in [v3-manifest.json](./v3-manifest.json).

Legacy `v: 1` and `v: 2` envelopes, `token`, `deferred_token`, and `POST /api/v1/ingest/supplement` are removed. Requests with `v != 3` are rejected with HTTP `400` (`code: "unsupported_wire_version"`).

---

## 1. Unified Request and Response Envelope

### 1.1 Request Body (`IdentifyIn` / `IngestIn`)

Both `POST /api/v1/ingest` and `POST /api/v1/identify` accept the same top-level JSON object:

| Field | Type | Required | Description |
|---|---|---|---|
| `v` | `int` | required | Wire protocol version. Must equal `3`. |
| `sdk` | `{ platform: string, version: string }` | required | Client SDK identifier and version. `sdk.platform` is bound to the authenticated credential scope via `caller.BindPlatform`. |
| `consent` | `string` | required | End-user collection consent state. Must equal `"granted"`. |
| `signals` | `object` (raw UTF-8 JSON) | required | Raw platform telemetry report (`schema: 2` on iOS and Android per [native-report.md](./native-report.md)). Verified as raw UTF-8 wire bytes before JSON decoding. |
| `attest` | `AttestEnvelope` | conditional | Hardware and platform attestation proof. Omitted on Web; optional on native when `require_attestation == false`; required on native when `require_attestation == true`. |
| `tag` | `string` | optional | Opaque caller correlation label stored with the event. On native attested requests it is bound into `statementDigest` with `sdk` and `consent` (section 3.2). |

### 1.2 `AttestEnvelope` Fields

When `attest` is present, it is a JSON object with the following fields:

| Field | Type | Required | Encoding and Semantics |
|---|---|---|---|
| `mode` | `string` | required | One of `"app_attest_register"`, `"app_attest_assert"`, `"android_key_register"`, `"android_key_assert"`. |
| `challenge` | `string` | required | Unpadded `base64url` (RFC 4648 §5) stateless KMS-signed challenge ticket (`<= 128` decoded bytes). Bound into `framedPreimage` as its exact ASCII wire string. |
| `install_id` | `string` | required | Canonical 36-character lowercase UUIDv4 (`xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx`). Validated pre-decode for syntax and cross-checked post-decode against `sources.identity.value.install_id` (`attestation_failed`, `reason: "install-id-mismatch"` on mismatch). |
| `key_id` | `string` | required | iOS: standard Base64 App Attest key identifier (32 decoded bytes). Android: 64-character lowercase hex SHA-256 of the signing key's ASN.1 DER `SubjectPublicKeyInfo` (SPKI). |
| `attestation_object` | `string` | when `mode == "app_attest_register"` | Standard Base64 Apple App Attest CBOR attestation object (at most 32 KiB decoded). |
| `assertion` | `string` | when `mode == "app_attest_assert"` | Standard Base64 Apple App Attest CBOR assertion object (at most 32 KiB decoded). |
| `device_token` | `string` | optional | Standard Base64 Apple `DCDevice` token (at most 4 KiB decoded), generated on iOS when `device_check == true` in the challenge offer and bound into `statementDigest`. |
| `certificate_chain` | `string[]` | when `mode == "android_key_register"` | Array of standard Base64 ASN.1 DER X.509 certificates (leaf signing key first, attestation root last; at most 32 KiB total decoded). |
| `signature` | `string` | Android modes | Standard Base64 ASN.1 DER ECDSA P-256 signature (`SHA256withECDSA`) over `framedPreimage`. Required on `"android_key_register"` and `"android_key_assert"`. |
| `prev_key_id` | `string` | optional | 64-character lowercase hex SHA-256 of the retiring Android signing key's SPKI DER during 24-hour key rollover (`K1 -> K2`). |
| `prev_signature` | `string` | optional | Standard Base64 ASN.1 DER `SHA256withECDSA` signature produced by `prev_key_id` over the identical `framedPreimage`, proving same-device key custody during rollover. |
| `play_integrity_token` | `string` | optional | Google Play Integrity standard token (at most 16 KiB) whose `requestDetails.requestHash` equals `hex(statementDigest)` (64-character lowercase hex). |
| `reattest_attempt` | `int` | optional | Bounded integer in `0..1` (`0` when omitted). Set to `1` when Android performs its single allowed inline key renewal within one `identify()` call. Bound into `statementDigest` through `envelopeDigest` (section 3.2). |

### 1.3 Response Body (`IdentifyOut`)

`IdentifyOut` removes `deferred_token` and the iOS-only `app_attest_key` field, and standardizes unidentifiable visitor outputs and attestation metadata:

| Field | Type | Presence | Description |
|---|---|---|---|
| `request_id` | `string` | always | Unique event identifier. |
| `identifiable` | `bool` | always | Whether the submission met platform identifiability criteria. |
| `visitor_id` | `string` | always | Stable project-scoped visitor identifier, or `""` whenever `identifiable == false`, the report is from a genuine embedded WebView, or an unmatched Web report is high-risk. |
| `visitor_is_new` | `bool` | always | `true` only when a new visitor row was minted; always `false` when `visitor_id == ""`. |
| `visitor_confidence` | `number` | always | Match confidence in `0..1` (`0` when `visitor_id == ""`). |
| `suspect_score` | `int` | audience-gated | Weighted risk score (omitted on public keys with `hide_client_score`). |
| `suspect_level` | `string` | audience-gated | `"low"`, `"medium"`, or `"high"` (omitted on public keys with `hide_client_score`). |
| `triggers` | `IdentifyTriggerOut[]` | audience-gated | Active risk signals and weights (omitted on public keys with `hide_client_score`). |
| `attest_key_status` | `string` | conditional (native) | Set to `"rekey_required"` on HTTP `200` when `require_attestation == false` and the presented iOS or Android `key_id` is unknown or expired. When `require_attestation == true`, unknown or expired keys return HTTP `403` (`code: "attestation_key_unknown"`). |
| `next_attestation` | `AttestationChallengeOut` | native responses | Fresh stateless challenge offer piggybacked on mobile responses for `1-RTT` steady-state calls. Omitted on Web. |

`AttestationChallengeOut` (returned both in `IdentifyOut.next_attestation` and by cold-start `POST /api/v1/attestation/challenge`):

| Field | Type | Description |
|---|---|---|
| `challenge` | `string` | Unpadded `base64url` stateless KMS-signed challenge ticket. |
| `expires_at` | `string` | RFC 3339 UTC expiration timestamp (`issued + 300s`). |
| `app_attest` | `bool` | `true` when Apple App Attest is offered for the authenticated SDK key. |
| `device_check` | `bool` | `true` when Apple DeviceCheck token generation is offered. |
| `play_integrity` | `bool` | `true` when Google Play Integrity token generation is offered. |

---

## 2. `Idempotency-Key` Header Rules

1. **Syntax**: `16..128` bytes (inclusive) of printable ASCII characters in range `0x21..0x7E` (`!` through `~`). Whitespace (`0x20`), control bytes, and non-ASCII bytes are rejected.
2. **Mandatory Presence**:
   - Required on **all** `POST /api/v1/ingest` `v: 3` requests (Web and Native).
   - Required on `POST /api/v1/identify` `v: 3` requests whenever `attest` is present (`attest != null`).
   - Optional only on unattested secret-key `POST /api/v1/identify` requests (`attest` omitted).
   - Missing or malformed headers fail pre-gate validation with HTTP `400` (`code: "invalid_idempotency_key"`).
3. **Admission and Duplicate Semantics**:
   - The server hashes the raw HTTP request body (`SHA256(rawBody)[0:16]`) and claims `idemKey` (`EX 3600`) in `Gate` before cryptographic verification or JSON map allocation.
   - Reusing an `Idempotency-Key` with a different `SHA256(rawBody)[0:16]` returns HTTP `409 Conflict` (`code: "idempotency_key_reused_with_different_payload"`).
   - Retrying while the original request is still `"pending"` returns HTTP `409 Conflict` (`code: "request_in_progress"`, `Retry-After: 1`) without blocking handler goroutines.
   - Retrying after completion (`"done"`) replays the stored verdict projected through `audienceOf(caller)` and attaches a freshly minted `next_attestation` offer for mobile callers.

---

## 3. Raw UTF-8 `signalsBytes` and Cryptographic Statement

### 3.1 Zero-Re-Canonicalization Rule

Cross-language JSON canonicalizers are prohibited. Mobile SDKs serialize the report object **once** to a UTF-8 byte buffer (`signalsBytes`), compute `signalsDigest = SHA256(signalsBytes)`, and splice `signalsBytes` verbatim as the JSON value of `"signals"` in the outgoing HTTP request body.

On the server, `CaptureBody` retains exact wire bytes and extracts `IdentifyIn.Signals` as raw UTF-8 bytes (`jsontext.Value`), preserving whitespace, key ordering, and numeric formatting (for example, `142.50` vs. `142.5` or `1e-05` vs. `0.00001`). Cryptographic verification runs against those raw wire bytes **before** `signals` is unmarshaled into typed report structures.

### 3.2 `framedPreimage` and `statementDigest` Construction

```text
signalsDigest     = SHA256(signalsBytes)
deviceTokenDigest = SHA256(deviceTokenBytes) // 32 zero bytes (0x00) when device_token is absent
envelopeDigest    = SHA256(tagUTF8              || "\x00" ||
                           sdkPlatformUTF8      || "\x00" ||
                           sdkVersionUTF8       || "\x00" ||
                           consentUTF8          || "\x00" ||
                           reattestAttemptASCII || "\x00")
framedPreimage    = "fingerly:v3:identify\x00" ||
                    authenticatedPlatform       || "\x00" ||
                    challengeTicketASCII        || "\x00" ||
                    installIDUTF8               || "\x00" ||
                    idempotencyKeyUTF8          || "\x00" ||
                    deviceTokenDigest           ||
                    envelopeDigest              ||
                    signalsDigest
statementDigest   = SHA256(framedPreimage)
```

Exact input byte encodings:

- `"fingerly:v3:identify\x00"`: 20 ASCII bytes `"fingerly:v3:identify"` followed by a single NUL byte (`0x00`).
- `authenticatedPlatform`: Exact ASCII platform token bound by `caller.BindPlatform(sdk.platform)` (`"ios"` or `"android"`), followed by `0x00`.
- `challengeTicketASCII`: Exact ASCII `base64url` string carried in `attest.challenge` (not base64-decoded), followed by `0x00`.
- `installIDUTF8`: 36-byte lowercase ASCII UUIDv4 string carried in `attest.install_id`, followed by `0x00`.
- `idempotencyKeyUTF8`: Exact ASCII string from the `Idempotency-Key` HTTP header, followed by `0x00`.
- `deviceTokenDigest`: 32 raw bytes. When `attest.device_token` is present and non-empty, `SHA256(Base64Decode(attest.device_token))`; when `attest.device_token` is absent or `""`, 32 zero bytes (`0x00 * 32`). No trailing `0x00` separator follows fixed-width digests.
- `envelopeDigest`: 32 raw bytes of `SHA256` over five fields, each followed by one `0x00`:
  - `tagUTF8`: the UTF-8 bytes of the top-level `tag` string exactly as sent (after JSON string decoding); the empty string (zero bytes) when `tag` is omitted.
  - `sdkPlatformUTF8`: the UTF-8 bytes of `sdk.platform` exactly as sent, including a bridge name such as `"react-native-android"`. This is not `authenticatedPlatform`.
  - `sdkVersionUTF8`: the UTF-8 bytes of `sdk.version` exactly as sent.
  - `consentUTF8`: the UTF-8 bytes of `consent` exactly as sent (always `"granted"` on an accepted request).
  - `reattestAttemptASCII`: `attest.reattest_attempt` as decimal ASCII digits with no sign or leading zeros (`"0"` or `"1"`); `"0"` when the member is omitted.

  The API refuses a control character (U+0000 to U+001F, U+007F) in `tag`, `sdk.platform` and `sdk.version` with 400 `invalid_request`, and any `consent` other than `"granted"` with `consent_required`, before attestation is verified, so no framed field can contain the `0x00` terminator. The server recomputes `envelopeDigest` from the request's own decoded `tag`, `sdk` and `consent` members and from `attest.reattest_attempt`; a change to any of them after signing fails verification with `attestation_failed`. A client hashes exactly the strings it serializes into the body.
- `signalsDigest`: 32 raw bytes of `SHA256(signalsBytes)`.
- `statementDigest`: 32 raw bytes of `SHA256(framedPreimage)`.

The fixed-width tail of `framedPreimage` is 96 bytes: `deviceTokenDigest || envelopeDigest || signalsDigest`. Golden vectors in [v3-manifest.json](./v3-manifest.json) carry the envelope inputs (`tag`, `sdk_platform`, `sdk_version`, `consent`, `reattest_attempt`) and `envelope_digest_hex` for each statement.

---

## 4. Platform Cryptographic Bindings

### 4.1 Android Keystore (`android_key_register` and `android_key_assert`)

- **Signing Key Parameters**: App-wide persistent EC P-256 keypair in `AndroidKeyStore` (`alias = "io.fingerly.sdk.attest.v3"`, `KeyProperties.PURPOSE_SIGN`, `KeyProperties.DIGEST_SHA256`, hardware TEE/StrongBox where supported, never `setUserAuthenticationRequired(true)` and never `setDevicePropertiesAttestationIncluded(true)`). `key_id` is `hex(SHA256(spkiDER))` (64 lowercase hex characters).
- **Registration (`"android_key_register"`)**: Generates the keypair with `KeyGenParameterSpec.Builder.setAttestationChallenge(statementDigest)` so the 32-byte `statementDigest` is sealed inside the X.509 KeyMint attestation extension (`1.3.6.1.4.1.11129.2.1.17`), sends `certificate_chain`, and signs raw `framedPreimage` into `signature`.
- **Assertion and JCA Single-Hash Verification (`"android_key_assert"` and `"android_key_register"`)**: The client passes the raw `framedPreimage` byte array into `Signature.getInstance("SHA256withECDSA")`, which hashes `framedPreimage` once internally with SHA-256 to obtain `statementDigest` and produces an ASN.1 DER ECDSA signature. The Go server verifies `ecdsa.VerifyASN1(pub, statementDigest, sig)` against the leaf/stored SPKI EC P-256 public key.
- **24-Hour Lease and Signed Key Rollover (`prev_key_id` + `prev_signature`)**: Verified Android keys carry a 24-hour server lease (`expires_at = attested_at + 24h`) and renew early on client `Build.VERSION.INCREMENTAL` or `Build.VERSION.SECURITY_PATCH` changes. When renewing inline (`reattest_attempt = 1`, `K1 -> K2`) while retiring key `K1` remains in `AndroidKeyStore`, the client signs the **identical** `framedPreimage` with `K1` and sends `prev_key_id` and `prev_signature`. Validating `prev_signature` proves same-device custody, expires `K1`, and transfers `last_install_id_hash` ownership to `K2` without firing `install-id-hijack`.

### 4.2 iOS App Attest and DeviceCheck (`app_attest_register` and `app_attest_assert`)

- **Registration (`"app_attest_register"`)**: Passes the 32-byte `statementDigest` as `clientDataHash` to `DCAppAttestService.shared.attestKey(keyId, clientDataHash: statementDigest)`. The server verifies the Apple App Attest X.509 chain, `nonce = SHA256(authenticatorData || statementDigest)`, RP ID hash `SHA256(teamID + "." + bundleID)`, public key hash matching `key_id`, and initial `counter == 0`.
- **Assertion (`"app_attest_assert"`)**: Passes `statementDigest` as `clientDataHash` to `DCAppAttestService.shared.generateAssertion(keyId, clientDataHash: statementDigest)`. The server computes `nonce = SHA256(authenticatorData || statementDigest)`, verifies the ECDSA P-256 signature over `nonce` (`SHA256(nonce)`), requires `authenticatorData.flags & 0x40 == 0` (attested credential data flag cleared on assertions), verifies the RP ID hash, and atomically enforces strictly monotonic `counter > previous_counter`.
- **DeviceCheck Binding**: When `device_token` is present, its decoded bytes are hashed into `deviceTokenDigest` inside `framedPreimage`, binding the Apple `DCDevice` token to the App Attest signature and `signalsBytes`.
- **Replacement Backoff**: Because `attestKey` calls Apple servers and increments Apple's 30-day key metric, iOS never deletes keys inline per call; `"rekey_required"` or `403 attestation_key_unknown` schedules replacement on a subsequent collection under persistent storm backoff (`immediate -> 7d -> 14d -> 30d`, resetting after `90d` of key stability).

### 4.3 Google Play Integrity (`play_integrity_token`)

- When `play_integrity == true` in the challenge offer and the optional Play Integrity provider is configured, the Android client requests a standard token via `StandardIntegrityTokenRequest.builder().setRequestHash(hex(statementDigest)).build()`, where `hex(statementDigest)` is the 64-character lowercase hexadecimal encoding of `statementDigest`.
- The server decodes `play_integrity_token` at most once per challenge ticket (caching the outcome on the ticket's Redis claim record for idempotent retries) and requires `requestDetails.requestHash == hex(statementDigest)` alongside matching package name and certificate SHA-256 digests; any mismatch emits `attestation_failed`.

---

## 5. Stateless KMS-Signed Challenge Ticket Binary Layout

Challenge tickets are minted and verified using the Cloud KMS-unwrapped `attestationKeyring` (supporting active signing key selection plus previous-key verification across rotation). Before unpadded `base64url` encoding, the raw binary ticket (`91..123` bytes, always `<= 128` bytes) has the exact layout:

```text
0x03                                   (1B: ticket_version = 3)
|| key_id_len_u8                       (1B: 0..32)
|| key_id_bytes                        (0..32B: UTF-8 keyring key identifier)
|| offer_flags_u8                      (1B: bit0=app_attest, bit1=device_check, bit2=play_integrity)
|| issued_unix_u32_be                  (4B: big-endian unsigned Unix seconds)
|| exp_unix_u32_be                     (4B: big-endian unsigned Unix seconds, issued + 300)
|| org_uuid_16B                        (16B: raw RFC 4122 UUID bytes of organization_id)
|| sdk_key_uuid_16B                    (16B: raw RFC 4122 UUID bytes of sdk_key_id)
|| rand_16B                            (16B: CSPRNG per-ticket random nonce)
|| HMAC_SHA256(key, header_and_claims) (32B: HMAC-SHA256 over all preceding bytes)
```

Field invariants:

- **`offer_flags_u8` bitmask**:
  - `bit 0` (`0x01`, `1`): `app_attest` offered
  - `bit 1` (`0x02`, `2`): `device_check` offered
  - `bit 2` (`0x04`, `4`): `play_integrity` offered
  - `bits 3..7`: reserved (`0`)
- **`header_and_claims`**: Exact byte slice from byte `0` (`0x03`) through the end of `rand_16B` (`59 + key_id_len_u8` bytes).
- **Single-Use Redemption**: After verifying `version == 0x03`, `key_id_len_u8 <= 32`, constant-time `HMAC_SHA256`, `org_uuid_16B == caller.OrganizationID`, `sdk_key_uuid_16B == caller.SDKKeyID`, and `now <= exp_unix_u32_be`, the server atomically claims `chall:v3:<hex(rand_16B)>` in Redis for the ticket's remaining TTL. First redemption with non-empty `Idempotency-Key` records `retry_hash = SHA256(idempotencyKey || "\x00" || signalsDigest)`. Subsequent presentations succeed only when `Idempotency-Key` is non-empty and `retry_hash` matches identically; otherwise `attestation_failed` (`reason: "challenge-replayed"`) fires.
