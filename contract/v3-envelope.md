# v3 Wire Envelope and Cryptographic Binding Contract

This specification defines the unified `v: 3` HTTP request and response wire contract across Web, iOS, Android, mobile framework bridges, first-party proxies, and the Go verification server (`POST /api/v1/ingest` and `POST /api/v1/identify`). Machine-readable constants and deterministic SHA-256 test vectors live alongside this document in [v3-manifest.json](./v3-manifest.json).

`v: 3` is the only wire version. Requests with `v != 3` are rejected with HTTP `400` (`code: "unsupported_wire_version"`).

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
| `attest_skipped` | `string` | optional (native) | Why a native report carries no `attest` (section 1.4). Never sent together with `attest`, and never sent on Web. |
| `op` | `string` | optional (Web) | Omitted for a report. `"ticket"` turns the request into a web freshness ticket request (section 1.6), whose body is `v`, `op` and `sdk` only. Any other value is refused with HTTP `400` (`code: "invalid_request"`). |
| `ticket` | `string` | optional (Web) | The web freshness ticket from a ticket request or from the previous answer's `next_ticket` (section 1.6). A native report carrying one is refused with HTTP `400` (`code: "invalid_request"`). |
| `ticket_pow` | `string` | optional (Web) | The proof of work for a ticket whose answer carried `pow_bits` (section 1.7). Refused on native reports like `ticket`. |
| `continuity` | `string` | optional (Web) | `"session"` asks for `next_seal` with an identified answer (section 1.8). Omitted, no seal is issued and the page keeps nothing. Never sent on a ticket request. |
| `seal` | `string` | optional (Web) | With `continuity: "session"`: the `next_seal` of the previous answer in this tab (section 1.8). Unpadded `base64url`, at most 256 characters. One that does not verify is ignored. Never sent on a ticket request. |

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
| `device_token` | `string` | optional | Standard Base64 Apple `DCDevice` token (at most 4 KiB decoded), generated on iOS when `device_check == true` in the challenge offer and bound into `statementDigest`. The server holds it for one hour; a DeviceCheck read (`POST /api/v1/events/{request_id}/device-check/query`) spends it. |
| `device_token_write` | `string` | optional | A second standard Base64 Apple `DCDevice` token (at most 4 KiB decoded), generated beside `device_token` and bound into `statementDigest`. The server holds it for one hour; a DeviceCheck write (`PUT /api/v1/events/{request_id}/device-check`) spends it (section 4.2). |
| `certificate_chain` | `string[]` | when `mode == "android_key_register"` | Array of standard Base64 ASN.1 DER X.509 certificates (leaf signing key first, attestation root last; at most 32 KiB total decoded). |
| `signature` | `string` | Android modes | Standard Base64 ASN.1 DER ECDSA P-256 signature (`SHA256withECDSA`) over `framedPreimage`. Required on `"android_key_register"` and `"android_key_assert"`. |
| `prev_key_id` | `string` | optional | Key ID of the previous confirmed key, sent with its continuity proof. Android: 64-character lowercase hex SHA-256 of the retiring signing key's SPKI DER during key rollover (`K1 -> K2`). iOS: standard Base64 App Attest key identifier, only on `"app_attest_register"` (section 4.2). |
| `prev_signature` | `string` | optional (Android) | Standard Base64 ASN.1 DER `SHA256withECDSA` signature produced by `prev_key_id` over the identical `framedPreimage`, proving same-device key custody during rollover. |
| `prev_assertion` | `string` | optional (iOS) | Standard Base64 CBOR App Attest assertion generated by the `prev_key_id` key with `clientDataHash = statementDigest`. Only allowed when `mode == "app_attest_register"`; `prev_key_id` or `prev_assertion` on `"app_attest_assert"` is refused with HTTP `400` (`code: "invalid_request"`). |
| `play_integrity_token` | `string` | optional | Google Play Integrity standard token (at most 16 KiB) whose `requestDetails.requestHash` equals `hex(statementDigest)` (64-character lowercase hex). |
| `reattest_attempt` | `int` | optional | Bounded integer in `0..1` (`0` when omitted). Set to `1` when Android performs its single allowed inline key renewal within one `identify()` call. Bound into `statementDigest` through `envelopeDigest` (section 3.2). |

### 1.3 Response Body (`IdentifyOut`)

`IdentifyOut` carries the verdict, unidentifiable visitor outputs and attestation key metadata:

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
| `attest_key_status` | `string` | whenever `attest` was sent | What became of the presented key: `"registered"`, `"valid"`, `"rekey_required"` or `"rejected"` (section 1.5). Given to every audience, including public keys with `hide_client_score`. |
| `attest_key_id` | `string` | whenever `attest` was sent | The `key_id` the server evaluated on this request, copied from `attest.key_id`. |
| `next_attestation` | `AttestationChallengeOut` | native responses | Fresh stateless challenge offer piggybacked on mobile responses for `1-RTT` steady-state calls. Omitted on Web. |
| `next_ticket` | `WebTicketOut` | Web responses | A fresh web freshness ticket for the next report from the same page, so it needs no ticket request (section 1.6). Left out when no ticket could be signed; the page then asks for one. Omitted on native. |
| `next_seal` | `WebSealOut` | Web responses to `continuity: "session"` | The session seal to send as `seal` on the next report from this tab (section 1.8). Present only when a private window was identified and a seal could be signed. Omitted on native. |

`AttestationChallengeOut` (returned both in `IdentifyOut.next_attestation` and by cold-start `POST /api/v1/attestation/challenge`):

| Field | Type | Description |
|---|---|---|
| `challenge` | `string` | Unpadded `base64url` stateless KMS-signed challenge ticket. |
| `expires_at` | `string` | RFC 3339 UTC expiration timestamp (`issued + 300s`). |
| `app_attest` | `bool` | `true` when Apple App Attest is offered for the authenticated SDK key. |
| `device_check` | `bool` | `true` when Apple DeviceCheck token generation is offered. |
| `play_integrity` | `bool` | `true` when Google Play Integrity token generation is offered. |
| `digest_salt` | `string` | The project's 32-byte name digest salt, unpadded `base64url`. The SDK caches it per SDK key beside the install record and keys every name digest with it ([native-report.md](./native-report.md) section 1.4). Absent when the server has none to give; the SDK then digests under 32 zero bytes. |

### 1.4 `attest_skipped`

A native client sets `attest_skipped` whenever it sends a report without `attest`, choosing the value that matches the failure. The allowed values are exactly:

| Value | Meaning |
|---|---|
| `not_offered` | The server made no challenge offer, or the offer did not include attestation for this key. |
| `unsupported` | The device or OS cannot hold an attested key (no App Attest service on iOS, below API 24 on Android). |
| `challenge_unavailable` | The challenge request failed, or its ticket was unusable. |
| `key_error` | Generating, attesting, loading or signing with the key failed. |
| `timeout` | The key store, or another call's attestation, did not finish within the attestation budget. |
| `backoff` | A new key registration is held off inside the replacement backoff window. |
| `install_unavailable` | No usable install ID, or the key record could not be read or written. |

The API refuses `attest_skipped` with HTTP `400` (`code: "invalid_request"`) when it is sent together with `attest`, on a Web platform, or with any other value. The field is diagnostic only: it never lowers or raises the score and exempts nothing. It is stored with the event and shown in the `attestation_missing` trigger detail (`attestation-skipped-<value>`, with `_` written as `-`).

### 1.5 Attestation Key Status and Confirmation

`attest_key_status` and `attest_key_id` are present on every `IdentifyOut` whose request carried `attest`, and absent otherwise:

| Value | Meaning |
|---|---|
| `registered` | An `*_register` request was verified, and the key is now stored and owns the install. |
| `valid` | An `*_assert` request was verified against a stored key. |
| `rekey_required` | The presented key is unknown or expired, or the attestation could not be proven either way (for example an expired ticket or a store outage on the server side). The key was not stored. |
| `rejected` | Attestation was present and failed (any `attestation_failed` reason, `install-id-hijack` included). |

When the key requires attestation (`require_attestation == true`), a request whose attestation is not proven gets no `IdentifyOut`: an unknown or expired key is refused with HTTP `403` (`code: "attestation_key_unknown"`), an outage with HTTP `503` (`code: "attestation_unavailable"`), and any other unproven report with HTTP `403` (`code: "attestation_required"`).

A duplicate replay (section 2) returns the `attest_key_status` and `attest_key_id` stored with the original verdict, so a client whose first response was lost learns the same outcome on retry.

Client rules on Android and iOS:

- A newly generated key is pending until a response to a request that carried it says `attest_key_status == "registered"`, or `"valid"` for a pending key probed with an assertion, with `attest_key_id` equal to that key's ID. Only then is it confirmed. Any other answer, an HTTP error, a timeout or a lost response leaves it pending. A response confirms only the key its own request carried.
- The previous confirmed key is kept until its successor is confirmed, and signs the continuity proof (`prev_key_id` with `prev_signature` on Android, `prev_key_id` with `prev_assertion` on iOS) on every registration of the successor, so a lost response does not cause `install-id-hijack`. Apple attests a key once, so iOS probes a pending key whose registration outcome was lost with an `"app_attest_assert"` on the next call.
- `rejected` on a pending key discards that key, keeps the previous confirmed key and applies the backoff. `rekey_required` on a probed pending key means the server never stored it.
- Attestation work is single-flight per process: concurrent `identify()` calls never register two keys.

### 1.6 Web Freshness Ticket

A web report carries no hardware proof, so nothing in it says when it was collected. The ticket makes a recorded web report impossible to replay: a report that carries a valid ticket was sent within five minutes of the ticket being issued, from the page origin it was issued to, and no other report has carried it. It does not make a web report trustworthy, because a script that holds the public key can ask for a ticket too.

**Ticket request.** Web only, on a public key, through the same paths as reports, so a first-party proxy needs no change: `POST /api/v1/ingest` or `POST /api/v1/identify` with the body

```json
{"v":3,"op":"ticket","sdk":{"platform":"web","version":"<sdk version>"}}
```

The Origin rules are those of a report (a proxy forwards `x-fingerly-origin`). A ticket request on a secret key or a native platform, or one that carries `signals`, `attest`, `attest_skipped`, `ticket` or `ticket_pow`, is refused with HTTP `400` (`code: "invalid_request"`, `details[0].field == "op"`). It is never charged and is rate limited per client address in a bucket of its own (HTTP `429`, `code: "rate_limited"`, with `Retry-After`).

**Answer.** HTTP `200` with `Cache-Control: no-store` and a `WebTicketOut`:

| Field | Type | Presence | Description |
|---|---|---|---|
| `ticket` | `string` | always | Unpadded `base64url` ticket, sent as `ticket` on the next report. Opaque to the client. |
| `expires_at` | `string` | always | RFC 3339 UTC time the ticket stops being accepted (`issued + 300s`). |
| `pow_bits` | `int` | when the key asks for proof of work | Leading zero bits `ticket_pow` must produce (section 1.7). |

Every web `IdentifyOut` carries the same object as `next_ticket`. A duplicate replay of a web verdict carries a fresh `next_ticket`, metered in the ticket bucket.

**Binding.** The ticket is stateless and signed with the attestation keyring that signs native challenge tickets, under a key derived for web tickets only (`HMAC-SHA256(challengeKey, "fingerly:v3:web-ticket\x00")`) and with its own leading byte, so neither kind can stand in for the other. Its binary layout before encoding:

```text
0x57                                   (1B: web ticket type)
|| key_id_len_u8                       (1B: 0..32)
|| key_id_bytes                        (0..32B: UTF-8 keyring key identifier)
|| pow_bits_u8                         (1B: 0..22, 0 for no proof of work)
|| issued_unix_u32_be                  (4B)
|| exp_unix_u32_be                     (4B: issued + 300)
|| org_uuid_16B                        (16B)
|| sdk_key_uuid_16B                    (16B: the public key it was issued to)
|| rand_16B                            (16B: CSPRNG nonce)
|| origin_digest_16B                   (16B: SHA256(page origin)[0:16])
|| HMAC_SHA256(webKey, everything before it) (32B)
```

**Redemption.** On a web report that authenticated with a public key (directly, through a first-party proxy or on a hosted domain), the server checks the signature, the organization, the SDK key, the origin digest and the expiry, then claims `web:<hex(rand_16B)>` in the atomic nonce store that native tickets use, for the ticket's remaining lifetime. The same submission retried with the same `Idempotency-Key` and the same `signals` bytes redeems its ticket again; any other second use is a reuse. A report a customer's backend relays with its secret key is not checked, and a store that cannot answer adds no evidence. The ticket is spent before its proof of work is checked.

**Scoring, never a refusal.**

| Signal | Weight | Confidence | Group | Reasons |
|---|---|---|---|---|
| `web_ticket_missing` | 4 | low | `report_incomplete` | `ticket-missing` (no ticket), `ticket-pow-missing` (the ticket asks for proof of work and `ticket_pow` is absent) |
| `web_ticket_invalid` | 20 | high | `browser_tampering` | `ticket-malformed` (bad encoding or signature, or claims the server never signs), `ticket-foreign` (another organization, key or origin), `ticket-expired`, `ticket-reused`, `ticket-pow-invalid` |

Both are web signals whose weights a customer can edit. Native reports never carry `ticket` or `ticket_pow`; one that does is refused with HTTP `400` (`code: "invalid_request"`, `details[0].field == "ticket"`).

**Web SDK rules.**

- Start the ticket request when collection starts, in parallel, so it adds no round trip.
- Use a held `next_ticket` instead when one is held and has more than 10 seconds left before `expires_at`.
- If the ticket request fails, send the report without a ticket. Never block or fail `identify()` on it.
- Keep tickets in memory only; never write them to storage.

### 1.7 Proof of Work on the Web Ticket

A per public key setting, `web_ticket_pow_bits`, an integer from `0` to `22`, default `0` (off), set through the key create and update APIs. When it is above `0`, the signed ticket carries the bit count (`pow_bits_u8`), so the server stays stateless, and the ticket answer adds `pow_bits`.

The client finds the smallest decimal nonce string `n`, counting from `"0"` upward, such that

```text
SHA256(ticketASCII || ":" || n)
```

has at least `pow_bits` leading zero bits, and sends it as top-level `ticket_pow` beside `ticket`. `n` is canonical decimal: `"0"`, or digits with no leading zero, at most 20 digits.

- Hash synchronously in JavaScript, not one `await` per hash.
- Solve off the main thread when a Worker is available, otherwise in time slices.
- Start solving as soon as the ticket arrives, in parallel with collection.
- Budget: 1500 ms. When it runs out, send the report without `ticket_pow` (which fires `web_ticket_missing` with `ticket-pow-missing`).

The server verifies with one hash. Vector: with ticket `abc` and 8 bits, checking every nonce from `"0"` upward, the first that passes is `"181"`. About 16 bits costs roughly 30 ms on a phone; above about 20 many devices run out of the budget and send no proof.

### 1.8 Web Session Seal

A private window keeps no state between visits, and what its answer was made on can change while the tab stays open. The session seal carries one identified private window across the reports of one tab: it is the platform's own earlier answer, signed, which the page shows again on its next report. It is not an identifier the browser chooses. It names one visitor, and it is honoured only for a report from the project, the page origin and the browser profile it was issued to.

The seal is opt-in per page. A page that does not ask for it sends neither field, receives no seal and keeps nothing in the browser.

**Request.** A web report on a public key (directly, through a first-party proxy or on a hosted domain) adds

| Field | Type | Presence | Description |
|---|---|---|---|
| `continuity` | `string` | every report of a page that turned continuity on | `"session"`. Any other value, or none, means no seal is read or issued. |
| `seal` | `string` | when the page holds an unexpired seal | The `seal` of the previous answer's `next_seal`. Unpadded `base64url`, at most 256 characters. |

A `seal` without `continuity: "session"` is ignored. Neither field is part of a ticket request (section 1.6), whose body stays `v`, `op` and `sdk` only. A native report, or one a customer's backend relays with its secret key, is never answered with a seal, and a seal it carries is ignored.

**Answer.** The `IdentifyOut` of a report that asked for `continuity: "session"` carries `next_seal`, a `WebSealOut`, when a private window was identified:

| Field | Type | Presence | Description |
|---|---|---|---|
| `seal` | `string` | always | Unpadded `base64url` seal, sent as `seal` on the next report from this tab. Opaque to the client. |
| `expires_at` | `string` | always | RFC 3339 UTC time the seal stops being accepted. |

`next_seal` is left out when the window was not identified, when the report did not ask, or when no seal could be signed, and always on a replayed answer (`duplicate: true`).

**Lifetime.** A seal is accepted for 30 minutes from the answer that issued it (`issued + 1800s`). Every answer that honours a seal issues the next one, which keeps the birth time of the session's first seal, so the session slides forward in 30 minute steps and ends 12 hours after its first seal at the latest: the last seal of a session expires at `born + 43200s`. After that the window is identified afresh or not at all. A seal is not single use and nothing is claimed in a store for it.

**Binding.** The seal is stateless and signed with the attestation keyring that signs challenge tickets and web tickets, under a key derived for seals only (`HMAC-SHA256(challengeKey, "fingerly:v3:web-seal\x00")`) and with its own leading byte, so a seal is never accepted as a ticket and a ticket never as a seal. Its binary layout before encoding (`127..159` bytes, `170..212` characters encoded):

```text
0x53                                   (1B: web seal type)
|| key_id_len_u8                       (1B: 0..32)
|| key_id_bytes                        (0..32B: UTF-8 keyring key identifier)
|| confidence_u8                       (1B: 0..100, the confidence of the answer the session started with)
|| born_unix_u32_be                    (4B: when the session's first seal was issued)
|| exp_unix_u32_be                     (4B: min(issued + 1800, born + 43200))
|| org_uuid_16B                        (16B)
|| project_uuid_16B                    (16B)
|| visitor_id_20B                      (20B: the visitor identifier the answer carried)
|| profile_digest_16B                  (16B: the browser profile the seal is bound to, scoped to the project)
|| origin_digest_16B                   (16B: SHA256(page origin)[0:16])
|| HMAC_SHA256(sealKey, everything before it) (32B)
```

**Verification, never a refusal.** The server honours a seal when its signature verifies under a current keyring key, it has not expired, its session is younger than 12 hours, and its organization, project and origin digest are those of the request; it then checks that the report's browser profile is the one the seal is bound to. A seal that fails any of these (malformed, forged, expired, issued to another project or origin, or carried to a browser that reads differently) is ignored: the report is answered as one without a seal, and never with an error. A seal never raises the confidence the session started with.

**Web SDK rules.**

- Session continuity is off unless the page turns it on (`continuity: 'session'`). Off, the SDK sends neither field, reads and writes no storage for a seal, and ignores a `next_seal`.
- On, send `continuity: "session"` on every report, and `seal` when a held seal has more than 10 seconds left before `expires_at`.
- Keep the seal in `sessionStorage` only, under the single key `__fingerly_seal__`, as `{"seal":"...","expires_at":"..."}`. Never in `localStorage`, a cookie, IndexedDB or `window.name`. It lives and dies with the tab.
- Read it only after consent is `granted`. Remove a stored value that is not a seal or has expired.
- After an answer, store its `next_seal` in place of the held seal. When the answer carries none, remove the held seal. A replayed answer (`duplicate: true`) changes nothing: keep the held seal.
- Remove the seal at once when consent is set to `denied`.
- Storage that is missing or throws means no seal is held. Never block, fail or log from `identify()` on it.
- The rule of section 1.6 still holds for tickets: keep tickets in memory only; never write them to storage.

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
   - Retrying after completion (`"done"`) replays the stored verdict projected through `audienceOf(caller)`, including the stored `attest_key_status` and `attest_key_id`, and attaches a freshly minted `next_attestation` offer for mobile callers.

---

## 3. Raw UTF-8 `signalsBytes` and Cryptographic Statement

### 3.1 Zero-Re-Canonicalization Rule

Cross-language JSON canonicalizers are prohibited. Mobile SDKs serialize the report object **once** to a UTF-8 byte buffer (`signalsBytes`), compute `signalsDigest = SHA256(signalsBytes)`, and splice `signalsBytes` verbatim as the JSON value of `"signals"` in the outgoing HTTP request body.

On the server, `CaptureBody` retains exact wire bytes and extracts `IdentifyIn.Signals` as raw UTF-8 bytes (`jsontext.Value`), preserving whitespace, key ordering, and numeric formatting (for example, `142.50` vs. `142.5` or `1e-05` vs. `0.00001`). Cryptographic verification runs against those raw wire bytes **before** `signals` is unmarshaled into typed report structures.

### 3.2 `framedPreimage` and `statementDigest` Construction

```text
signalsDigest     = SHA256(signalsBytes)
deviceTokenDigest = SHA256(readDigest || writeDigest) // 32 zero bytes when both tokens are absent
readDigest        = SHA256(readTokenBytes)            // 32 zero bytes when device_token is absent
writeDigest       = SHA256(writeTokenBytes)           // 32 zero bytes when device_token_write is absent
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
- `deviceTokenDigest`: 32 raw bytes. `readDigest` is `SHA256(Base64Decode(attest.device_token))`, and `writeDigest` is `SHA256(Base64Decode(attest.device_token_write))`; a token that is absent or `""` contributes 32 zero bytes (`0x00 * 32`) in its place. When either token is present, `deviceTokenDigest = SHA256(readDigest || writeDigest)`. When both are absent, `deviceTokenDigest` is 32 zero bytes. No trailing `0x00` separator follows fixed-width digests. Vectors: read token ASCII `read-token-bytes` and write token ASCII `write-token-bytes` give `c3a06cc18593f3c526c58bd7b1670f8f4ffc8fcfaeaee97460b777d6137ece23`; the read token alone gives `88b7e591bbb678f946dcfe3deb7ef46a2d2971dbc8ae29f181c4ea2b537d9ae9`.
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
- **Continuity Proof (`prev_key_id` + `prev_assertion`)**: When an install already has an owner key and a new key registers, the `"app_attest_register"` request carries `prev_key_id` (the standard Base64 key identifier of the previous confirmed key) and `prev_assertion` (an assertion generated by that key with `clientDataHash = statementDigest` of this very request). The server verifies `prev_assertion` against the stored public key of `prev_key_id` with the same checks as a normal assertion, the strictly monotonic counter included, and requires that `prev_key_id` currently owns the install. It then retires the previous key and transfers ownership to the new key without `install-id-hijack`. A registration for an owned install without a valid proof from the owner fails with `install-id-hijack`.
- **30-Day Ownership Lapse**: An App Attest key that has not been used for 30 days stops owning its install. A new key can then register for that install without a continuity proof, so a device that lost its key state is not locked out.
- **DeviceCheck Binding**: When the challenge offer sets `device_check`, the SDK generates two `DCDevice` tokens and sends them as `device_token` and `device_token_write`. Both are hashed into `deviceTokenDigest` inside `framedPreimage` (section 3.2), binding them to the App Attest signature and `signalsBytes`. When the evidence verifies, the server holds both, sealed, for one hour. `POST /api/v1/events/{request_id}/device-check/query` spends the read token and `PUT /api/v1/events/{request_id}/device-check` spends the write token, each with the same-request retry rule, so one identification supports one read and one write. A write on an event that carried no `device_token_write` answers HTTP `404` (`code: "device_check_not_held"`).
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

---

## 6. Consuming an Event Once

`POST /api/v1/events/{request_id}/consume`, secret key only, marks one identification event as consumed, so a request ID handed from a page or an app to the customer's backend backs one decision only:

- First call: HTTP `200` with `{"request_id":"...","consumed_at":"<RFC 3339>","first":true}`.
- Any later call: HTTP `409` (`code: "event_already_consumed"`), with the first consume's time in `details[0]` as `{"field":"consumed_at","issue":"<RFC 3339>"}`.
- Unknown event, or one older than 30 days: HTTP `404` (`code: "event_not_found"`). An event still being recorded: HTTP `404` (`code: "event_pending"`) with `Retry-After`.
- The claim is atomic and per organization. It is stored with the event, read back as `consumed_at` on `GET /api/v1/events/{request_id}`, and erased with the event.

Every server SDK wraps the read and the consume in `events.verify(requestId, options)`, with options `maxAgeSeconds` (default `300`), `tag` (optional) and `consume` (default `true`). It reads the event and returns `{ok, reason, event}`, where `reason` is empty when `ok` and otherwise the first failing check, in this order: `not_found`, `too_old`, `tag_mismatch`, `unidentifiable`, `unscored`, `already_consumed`. Consumption runs last, and only when every other check passed. `verify` never decides on the score: the score policy stays the caller's. `events.consume(requestId)` calls the route alone.
