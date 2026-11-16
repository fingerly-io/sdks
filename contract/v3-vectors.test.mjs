import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(root, 'v3-manifest.json'), 'utf8'))

function sha256(buf) {
  return createHash('sha256').update(buf).digest()
}

function formatUuid(bytes) {
  assert.equal(bytes.length, 16)
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function decodeTicket(challengeBase64Url, hmacKeyUtf8) {
  const raw = Buffer.from(challengeBase64Url, 'base64url')
  assert.equal(raw.toString('base64url'), challengeBase64Url, 'challenge must be canonical unpadded base64url')
  assert.ok(raw.length >= 91 && raw.length <= 128, `ticket length ${raw.length} out of bounds`)

  const version = raw.readUInt8(0)
  const keyIdLen = raw.readUInt8(1)
  assert.ok(keyIdLen <= 32, `key_id_len ${keyIdLen} exceeds 32`)
  assert.equal(raw.length, 91 + keyIdLen, 'ticket byte length must match 91 + key_id_len')

  let offset = 2
  const keyId = raw.subarray(offset, offset + keyIdLen).toString('utf8')
  offset += keyIdLen

  const offerFlags = raw.readUInt8(offset)
  offset += 1

  const issuedUnix = raw.readUInt32BE(offset)
  offset += 4

  const expUnix = raw.readUInt32BE(offset)
  offset += 4

  const organizationId = formatUuid(raw.subarray(offset, offset + 16))
  offset += 16

  const sdkKeyId = formatUuid(raw.subarray(offset, offset + 16))
  offset += 16

  const nonceHex = raw.subarray(offset, offset + 16).toString('hex')
  offset += 16

  const headerAndClaims = raw.subarray(0, offset)
  const mac = raw.subarray(offset, offset + 32)
  const expectedMac = createHmac('sha256', Buffer.from(hmacKeyUtf8, 'utf8')).update(headerAndClaims).digest()
  assert.ok(timingSafeEqual(mac, expectedMac), 'ticket HMAC-SHA256 verification failed')

  return {
    byteLength: raw.length,
    version,
    keyId,
    offerFlags,
    issuedUnix,
    expUnix,
    organizationId,
    sdkKeyId,
    nonceHex,
  }
}

function computeStatement({ domainSeparator, platform, challenge, installId, idempotencyKey, deviceToken, signalsBytes }) {
  const signalsDigest = sha256(signalsBytes)
  const deviceTokenDigest =
    deviceToken === '' ? Buffer.alloc(32, 0) : sha256(Buffer.from(deviceToken, 'base64'))

  const framedPreimage = Buffer.concat([
    Buffer.from(`${domainSeparator}\x00`, 'utf8'),
    Buffer.from(`${platform}\x00`, 'ascii'),
    Buffer.from(`${challenge}\x00`, 'ascii'),
    Buffer.from(`${installId}\x00`, 'utf8'),
    Buffer.from(`${idempotencyKey}\x00`, 'utf8'),
    deviceTokenDigest,
    signalsDigest,
  ])

  const statementDigest = sha256(framedPreimage)
  return {
    signalsDigestHex: signalsDigest.toString('hex'),
    deviceTokenDigestHex: deviceTokenDigest.toString('hex'),
    preimageByteLength: framedPreimage.length,
    statementDigestHex: statementDigest.toString('hex'),
  }
}

// Mirrors server/tests/unit/archive_fields_test.go contractFields()
function parseNativeReportSection(markdown, sectionHeading) {
  const start = markdown.indexOf(sectionHeading)
  assert.ok(start >= 0, `missing section heading: ${sectionHeading}`)
  let text = markdown.slice(start + sectionHeading.length)
  const end = text.indexOf('\n## ')
  if (end >= 0) {
    text = text.slice(0, end)
  }
  const headingRe = /^### ([a-z_]+)/
  const anyH3Re = /^### /
  const rowRe = /^\| `([a-z0-9_]+)` \| ([^|]*)\|/
  const headings = []
  const fields = {}
  let source = ''
  for (const line of text.split('\n')) {
    const hm = headingRe.exec(line)
    if (hm) {
      source = hm[1]
      headings.push(source)
      continue
    }
    assert.ok(!anyH3Re.test(line), `unexpected non-source ### heading inside ${sectionHeading}: ${line}`)
    const rm = rowRe.exec(line)
    if (rm && source !== '' && source !== 'integrity' && source !== 'device') {
      fields[source] ??= {}
      fields[source][rm[1]] = rm[2].trim()
    }
  }
  return { headings, fields }
}

test('v3-manifest metadata and golden challenge tickets', () => {
  assert.equal(manifest.schema, 3)
  assert.equal(manifest.wire_version, 3)
  assert.equal(manifest.domain_separator, 'fingerly:v3:identify')
  assert.equal(manifest.ticket_version, 3)
  assert.deepEqual(manifest.offer_flag_bits, {
    app_attest: 1,
    device_check: 2,
    play_integrity: 4,
  })
  assert.deepEqual(manifest.attest_modes, [
    'app_attest_register',
    'app_attest_assert',
    'android_key_register',
    'android_key_assert',
  ])
  assert.deepEqual(manifest.signals, {
    attestation_failed: 30,
    device_inconsistent: 18,
    report_incomplete: 16,
    tampering: 15,
    custom_root_ca: 0,
    secondary_user_profile: 0,
  })
  assert.equal(manifest.golden_vectors.length, 2)

  for (const vec of manifest.golden_vectors) {
    const decoded = decodeTicket(vec.challenge, manifest.test_hmac_key_utf8)
    assert.equal(decoded.byteLength, 93, `${vec.name}: expected 93-byte binary ticket`)
    assert.equal(decoded.version, 3, `${vec.name}: ticket version`)
    assert.equal(decoded.keyId, vec.key_id, `${vec.name}: key_id`)
    assert.equal(decoded.offerFlags, vec.offer_flags, `${vec.name}: offer_flags`)
    assert.equal(decoded.issuedUnix, vec.issued_unix, `${vec.name}: issued_unix`)
    assert.equal(decoded.expUnix, vec.exp_unix, `${vec.name}: exp_unix`)
    assert.equal(decoded.organizationId, vec.organization_id, `${vec.name}: organization_id`)
    assert.equal(decoded.sdkKeyId, vec.sdk_key_id, `${vec.name}: sdk_key_id`)
    assert.equal(decoded.nonceHex, vec.nonce_hex, `${vec.name}: nonce_hex`)
  }
})

test('v3-manifest golden vectors match signalsDigest, deviceTokenDigest, preimage length, and statementDigest', () => {
  for (const vec of manifest.golden_vectors) {
    const result = computeStatement({
      domainSeparator: manifest.domain_separator,
      platform: vec.platform,
      challenge: vec.challenge,
      installId: vec.install_id,
      idempotencyKey: vec.idempotency_key,
      deviceToken: vec.device_token,
      signalsBytes: Buffer.from(vec.signals_utf8, 'utf8'),
    })
    assert.equal(result.signalsDigestHex, vec.signals_digest_hex, `${vec.name}: signals_digest_hex`)
    assert.equal(result.deviceTokenDigestHex, vec.device_token_digest_hex, `${vec.name}: device_token_digest_hex`)
    assert.equal(result.preimageByteLength, vec.preimage_byte_length, `${vec.name}: preimage_byte_length`)
    assert.equal(result.statementDigestHex, vec.statement_digest_hex, `${vec.name}: statement_digest_hex`)
  }
})

test('JSON re-serialization mutates trailing float zeros and invalidates statementDigest', () => {
  const v1 = manifest.golden_vectors.find((v) => v.name === 'android_no_token')
  assert.ok(v1)
  assert.ok(v1.signals_utf8.includes('142.50'))

  const reserialized = JSON.stringify(JSON.parse(v1.signals_utf8))
  assert.ok(reserialized.includes('142.5'))
  assert.ok(!reserialized.includes('142.50'))
  assert.notEqual(reserialized, v1.signals_utf8)

  const mutated = computeStatement({
    domainSeparator: manifest.domain_separator,
    platform: v1.platform,
    challenge: v1.challenge,
    installId: v1.install_id,
    idempotencyKey: v1.idempotency_key,
    deviceToken: v1.device_token,
    signalsBytes: Buffer.from(reserialized, 'utf8'),
  })
  assert.notEqual(mutated.signalsDigestHex, v1.signals_digest_hex)
  assert.notEqual(mutated.statementDigestHex, v1.statement_digest_hex)
})

test('native-report.md preserves archive_fields_test.go machine-parser invariants and v3 fields', () => {
  const md = readFileSync(resolve(root, 'native-report.md'), 'utf8')
  const idx2 = md.indexOf('## 2. Android report')
  const idx3 = md.indexOf('## 3. iOS report')
  const idx4 = md.indexOf('## 4. Fields that embed a judgement today, and how each becomes raw')
  const idx11 = md.indexOf('## 11. v3 HTTP Envelope and Raw-Byte Attestation Binding')

  assert.ok(idx2 > 0, 'missing ## 2. Android report')
  assert.ok(idx3 > idx2, '## 3. iOS report must follow ## 2. Android report')
  assert.ok(idx4 > idx3, '## 4. heading must immediately follow ## 3. iOS report')
  assert.ok(idx11 > idx4, 'missing ## 11. v3 HTTP Envelope section')

  // Ensure no extra "## " heading was inserted inside Section 2 or Section 3
  assert.equal(md.indexOf('\n## ', idx2 + 1), idx3 - 1)
  assert.equal(md.indexOf('\n## ', idx3 + 1), idx4 - 1)

  const android = parseNativeReportSection(md, '## 2. Android report')
  assert.deepEqual(android.headings, [
    'identity',
    'system',
    'hardware',
    'display',
    'storage',
    'intl',
    'accessibility',
    'battery',
    'security',
    'sensors',
    'audio',
    'network',
    'app',
    'root',
    'emulator',
    'debugger',
    'instrumentation',
    'cloned',
    'images',
    'attest',
    'play_integrity',
    'tls',
    'integrity',
    'device',
  ])
  assert.equal(android.fields.cloned?.is_managed_profile, 'bool')
  assert.equal(android.fields.cloned?.is_device_protected_storage, 'bool')
  assert.equal(android.fields.tls?.root_key_sha256, 'string')

  const ios = parseNativeReportSection(md, '## 3. iOS report')
  assert.deepEqual(ios.headings, [
    'system',
    'hardware',
    'display',
    'storage',
    'intl',
    'accessibility',
    'battery',
    'security',
    'sensors',
    'audio',
    'network',
    'app',
    'identity',
    'jailbreak',
    'debugger',
    'instrumentation',
    'images',
    'fonts',
    'attest',
    'tls',
    'integrity',
    'device',
  ])
  assert.equal(ios.fields.hardware?.gpu_family_max, 'int')

  const androidFixture = JSON.parse(readFileSync(resolve(root, 'fixtures/native-report-android.json'), 'utf8'))
  assert.equal(androidFixture.sources.cloned.value.is_managed_profile, false)
  assert.equal(androidFixture.sources.cloned.value.is_device_protected_storage, false)
  assert.equal(androidFixture.sources.tls.value.root_key_sha256, 'YSoUL4CBzo5aJ/ES9gSZTsavsgtHsiLLnTG+BKUdork=')

  const iosFixture = JSON.parse(readFileSync(resolve(root, 'fixtures/native-report-ios.json'), 'utf8'))
  assert.equal(iosFixture.sources.hardware.value.gpu_family_max, 7)

  const envelopeDoc = readFileSync(resolve(root, 'v3-envelope.md'), 'utf8')
  const proxyDoc = readFileSync(resolve(root, 'proxy.md'), 'utf8')
  assert.ok(envelopeDoc.includes('fingerly:v3:identify'))
  assert.ok(proxyDoc.includes('missing_origin'))
})
