# What the SDKs collect

Written for the integrator, and for the privacy notice they have to write.

If you are embedding a Fingerly SDK, you are the controller for the data it
collects about your visitors and we are your processor. That means the notice,
the legal basis and the consent are yours to get right, and you cannot do any
of it without knowing exactly what the code reads, stores and sends. This
document is that list, checked against the code on 2026-09-25.

> **Read §4 before shipping to visitors in the EU or UK.** Every SDK has a
> `consent` option. It defaults to `pending`, so an integration that does
> nothing collects nothing, and the server refuses any submission not sent
> with consent granted. Granting it is your call, and your responsibility.

## 1. The short version

The SDKs read characteristics of the device and browser in order to judge
whether it is being misrepresented. How the same device is recognised across
visits differs by platform:

- **Browsers** are recognised by their device and browser characteristics
  (§2).
- **Native apps** (iOS, Android, and the React Native, Flutter and Lynx
  bridges) are recognised **only** by the random install ID the SDK stores on
  the device (§3.1). Hardware and operating system signals are never used to
  recognise a device or a user in an app; they serve integrity checks and
  scoring only. A native report without an install ID identifies nobody.

The SDKs do not read page content, form fields, keystrokes, mouse movement,
clipboard, contacts, photos, location services, or anything belonging to the
person rather than to the device.

What leaves the device is a set of signal values. What we add server-side is an
IP-derived, approximate location and network classification, a visitor
identifier and a risk score. The browser SDK leaves nothing behind on the
device; the mobile SDKs keep one install identifier (§3.1), which the app can
delete (§3.2).

## 2. Browser (`web-js` and the framework bindings)

36 sources, run in two tiers. The first tier runs within about 300 ms and its
answer is scored at once; the second continues for up to 1200 ms and is sent
afterwards as a separate deferred report, which is archived against the same
request but never changes the identity or the score.

**First tier**

| Group | Sources | What they read |
|---|---|---|
| Engine | `engine`, `math`, `errors` | How the JavaScript engine behaves: error text, built-in source, stack shape, maths results |
| Navigator | `navigator`, `languages`, `vendor`, `plugins` | User agent, platform, vendor, CPU cores, device memory, touch points, `webdriver`, cookie and PDF viewer flags, Do Not Track, languages, and the full plugin list with names, file names, descriptions and MIME types |
| Display | `screen`, `screen_frame`, `media_queries`, `color_gamut` | Screen and window geometry, colour depth, pixel ratio, orientation, and preference media queries (forced colours, reduced motion, HDR and similar) |
| Device | `hardware`, `touch`, `network`, `intl`, `timezone` | Cores and memory, touch and pointer capability, connection type and speed estimates, time zone, locale, calendar and number formatting |
| Storage | `storage`, `storage_quota` | Whether localStorage and sessionStorage are writable, IndexedDB and service worker presence, the storage quota estimate, whether storage is partitioned |
| Environment | `shields`, `timing`, `permissions`, `automation` | Privacy-hardened browser markers, whether canvas readback is noised (read from an 8x8 checkerboard the SDK draws itself), clock resolution, the **state** of the notification and geolocation permissions, and automation markers (headless browsers, WebDriver, Selenium and Playwright globals) |
| Rendering | `webgl` | GPU vendor and renderer strings, WebGL version and limits |

**Deferred tier**

| Group | Sources | What they read |
|---|---|---|
| Rendering | `canvas`, `webgl_extensions` | Canvas rendering output, supported WebGL extensions |
| Audio | `audio`, `audio_latency` | Offline audio rendering output, output latency |
| Text | `fonts`, `font_preferences` | Which fonts are installed, inferred by measuring text, and default font preferences |
| Hardware | `battery`, `sensors`, `media_devices` | Battery charging state and level; whether motion and orientation sensors exist and fire; the **number** of microphones, speakers and cameras (their labels are never read) |
| Voices | `speech` | The installed speech synthesis voices: name, language, whether local |
| Client hints | `user_agent_data` | Browser brands, platform, and the high-entropy hints: architecture, bitness, model, platform version, full browser versions |
| Filter lists | `dom_blockers` | Which content-blocking filter lists are active |
| Durability | `storage_durability` | IndexedDB commit timing, Chromium only, used to detect private browsing |

After collection a tamper layer (`lies/`) checks the other sources for
consistency. It reads nothing new.

Things worth stating plainly, because a privacy reviewer will ask:

- **Nothing prompts the visitor.** `permissions` reads a permission's state,
  which is specified never to prompt, and `media_devices` counts devices without
  asking for access, so no labels are revealed.
- **`dom_blockers` probes for blocked elements**, including selectors used by
  cookie-consent banners, to infer which filter lists are active. That is a
  signal derived from the visitor's privacy choices. If that is not acceptable
  in your deployment, raise it with us.
- **`speech` and `plugins` return lists**, not flags: every voice and every
  plugin by name. They are among the most identifying values collected.
- **The tamper layer exists to detect anti-detect browsers.** It is what lets us
  tell a genuinely privacy-hardened browser from one impersonating a normal
  browser, and it is why unstable signals carry no identity weight, so hardened
  browsers are not re-identified as new visitors on every page load.

### 2.1 What the browser SDK writes

Nothing that outlives the call. It writes no cookies, sends no cookies
(`credentials: 'omit'`), and keeps no identifier on the device. Three sources
write briefly in order to measure:

- `storage` writes a `__fingerly_probe__` key to localStorage and sessionStorage
  and removes it at once, to learn whether storage is writable;
- `storage_durability`, in Chromium only, creates an IndexedDB database named
  `__fingerly_durability_<random>`, writes test records to time the commits, and
  deletes the database;
- `dom_blockers` adds off-screen elements to the page and removes them.

It does not remove the ePrivacy Art. 5(3) question: reading device
characteristics is in scope whether or not anything is written.

## 3. Mobile (`ios`, `android`, and the React Native, Flutter and Lynx bridges)

The native SDKs read operating system and hardware characteristics, app
installation details, security settings and integrity indicators. None of it
is used to recognise the device (§1); it is evidence for the integrity verdicts
and the risk score.

**iOS**

- Model, memory, CPU, display, locale, battery and thermal state, audio route,
  and network interfaces including VPN tunnels and proxies.
- App installation details: bundle and signing, and the age of the app's own
  container in whole days (`container_age_d`). No bundle creation date.
- Security settings: whether a passcode is set, whether biometrics are
  enrolled.
- Accessibility: only how many settings differ from their defaults
  (`settings_changed`) and whether the default text size is in use
  (`default_text_size`). Never which features, such as VoiceOver, Switch
  Control or AssistiveTouch, are on.
- Fonts: only the number of installed font families, never their names or a
  digest of them.
- Attestation: only whether DeviceCheck and App Attest are supported. No
  DeviceCheck token is requested or sent.
- Integrity indicators: jailbreak, Simulator, debugger, hooking frameworks
  such as Frida, loaded libraries. Jailbreak checks are read-only existence
  tests (`access`, `readlink`); nothing is written or read outside the app's
  container.
- **Not read at all:** boot time, system uptime, and disk capacity or free
  space.

**Android**

- Model, memory, CPU, display, storage totals, locale, accessibility settings
  (how many differ from their defaults, never which services are on), battery
  and thermal state, the mobile network operator's name, and network interfaces
  including VPN tunnels and proxies.
- App installation details: package, signing, the installing store.
- Security settings: whether a lockscreen is set.
- Integrity indicators: root, emulator, debugger, hooking frameworks such as
  Frida, loaded libraries, key attestation.
- **Other apps, as booleans only.** Whether a root manager is installed
  (`root_manager_installed`), whether a hooking-framework manager is installed
  (`hook_manager_installed`), whether a cloning app is installed
  (`cloner_installed`), and whether this app runs inside another app's data
  directory (`data_dir_in_other_app`, with a count of other apps' sandboxes
  mapped into the process). No package name ever leaves the device.

The React Native, Flutter and Lynx packages are bridges, not reimplementations:
they call the native SDKs, so what is collected is whatever the native platform
they run on collects. Do not assume the JavaScript or Dart surface bounds it.

### 3.1 What the mobile SDKs store and send

| | iOS | Android |
|---|---|---|
| Stored on the device | One Keychain item (service `io.fingerly.sdk.install`) holding a random install ID, the first-seen time and a launch count. Device-only (`ThisDeviceOnly`), so not in backups, and it **survives uninstall**, so a reinstall keeps the same install ID | One file, `io.fingerly.sdk.install`, under the app's `noBackupFilesDir`, holding a random install ID, the first-seen time, the launch count and the signing certificate digest. Never copied by Auto Backup or device transfer, and **removed on uninstall**, so a reinstall starts a new install ID. A record left in SharedPreferences by an earlier version is moved there once and the preferences file deleted |
| How the server recognises the device | By the install ID only | By the install ID only |
| Platform identifier sent | `identifierForVendor`, as is | `ANDROID_ID`, hashed |
| Calls other than to Fingerly | None. The SDK asks only whether DeviceCheck and App Attest are supported | Key attestation in the Android Keystore, with a key created and deleted in the same run |
| Connection probe | Opens a TLS connection to the configured endpoint to inspect its certificate chain | The same |
| Permissions | None requested | `INTERNET` and `ACCESS_NETWORK_STATE`, which prompt nobody, plus a `<queries>` list naming 17 root, hooking and cloner packages (no `QUERY_ALL_PACKAGES`). An app can drop any entry with `tools:node="remove"` in its own manifest |
| Deleting the record | `Fingerly.deleteStoredIdentity()` | `Fingerly.deleteStoredIdentity(context)` |

**iOS privacy manifest.** The iOS SDK ships a `PrivacyInfo.xcprivacy`, in the
Swift package's resources and in the pod's `Fingerly_Privacy` resource bundle,
so Xcode includes it in the app's privacy report. It declares:

- `NSPrivacyTracking` false, and no tracking domains. The SDK does not track,
  so it needs no App Tracking Transparency prompt and asks for none.
- Collected data types, each linked to the user, not used for tracking, for
  the App Functionality purpose: Device ID, Coarse Location, Product
  Interaction, Other Data Types.
- One required-reason API: file timestamp, reason `C617.1`, for the creation
  date of the app's own container. The SDK uses no boot time, disk space,
  user defaults or active keyboard APIs.

The React Native, Flutter and Lynx bridges depend on the Fingerly pod, so the
manifest reaches those apps too.

### 3.2 Deleting the stored identity

Every mobile SDK has a call that deletes the install record from the device:
`Fingerly.deleteStoredIdentity()` on iOS, `Fingerly.deleteStoredIdentity(context)`
on Android, and `deleteStoredIdentity()` in the React Native, Flutter and Lynx
packages. Use it for erasure requests and account deletion. It needs no client
and no consent, sends nothing, and succeeds when there was no record. The next
identification made with consent starts a new install ID that nothing links to
the old one; set consent to `denied` first if nothing should be collected
afterwards. On iOS this is the only way to remove the record, because it
survives the app being deleted.

Deleting the record on the device does not delete what we already hold; send
that request to us as well (§4).

### 3.3 Guidance for app stores

- **Do not ship the SDK in Kids Category apps** (App Store Review Guideline
  1.3) or in Google Play apps directed at children.
- **Do not use the browser SDK inside a `WKWebView` in an iOS app.** Apple
  treats reading browser properties there as fingerprinting. Use the native
  SDK instead.
- **Consent defaults to pending** (§4), which is what App Store Review
  Guideline 5.1.1(ii) and Google Play's guidance on using SDKs safely ask for.

## 4. Consent: what you must do

Every SDK and binding takes a `consent` option: `'granted'`, `'pending'` or
`'denied'`, changeable later with `setConsent()`.

- **It defaults to `pending`.** If you pass nothing, the SDK collects nothing
  until you call `setConsent('granted')`. This holds for every entry point: the
  browser SDK and its script-tag build, the React, Next.js, Vue, Nuxt, Svelte
  and Angular bindings, iOS, Android, and the React Native, Flutter and Lynx
  bridges.
- With `'pending'` or `'denied'`, nothing is collected: loading reads nothing,
  and `identify()` and `collect()` throw a `ConsentError` (`consent_required`)
  before any source runs. Framework bindings set to identify on mount wait
  until consent becomes `'granted'`.
- Withdrawing consent mid-call stops what is still running: the browser SDK
  aborts the sources and the submission in flight and skips the deferred report;
  the mobile SDKs check again before each source and before submitting.
- **The server enforces it.** Every submission, the identification and the
  deferred report alike, carries the state it was collected under,
  `"consent": "granted"`, and the API refuses anything else with `422` and the
  same code, `consent_required`. The SDKs only ever send while consent is
  granted, so you should never see it; a hand-built request or a custom
  transport that drops the field will.
- **What the server cannot check** is whether consent was really given. It
  guarantees that every event it records was sent by an integration that said
  so; whether that statement is true is on the integration.

So, for visitors in the EU or UK:

1. **Keep the default, `consent: 'pending'`,** and call `setConsent('granted')`
   only once you have the lawful basis you have decided on. Pass
   `consent: 'granted'` at initialisation only if you already have it. Anything
   collected before that cannot be retracted.
2. **Treat fingerprinting as in scope for ePrivacy Art. 5(3).** Reading device
   characteristics is "gaining access to information stored in terminal
   equipment", and the EDPB's Guidelines 2/2023 confirm fingerprinting is
   covered. Whether fraud prevention qualifies for the strictly-necessary
   exemption is contested; take your own advice, and be aware that the
   conservative reading requires consent.
3. **Disclose it.** Your notice needs to name device fingerprinting for fraud
   prevention, name us as a processor, and say how long the data is kept (§7).
4. **Send erasure requests to us.** There is no self-service or API route to
   delete a visitor's data yet; contact us and we handle it manually. In an
   app, also call `deleteStoredIdentity()` on the device (§3.2).

## 5. First-party proxies and hosted subdomains

A **first-party proxy** serves the browser SDK from a path on your own site. It
forwards the submission to us unchanged, and adds the visitor's IP address,
page origin and user agent in headers, which the API accepts only together with
your proxy key. Visitor cookies and authorization headers are never forwarded.
For each proxy we keep the page origin it last served, the version it reports,
when it was last used, and a count of requests per day; nothing per visitor.

A **hosted subdomain** is a subdomain of your site that you point at us with a
CNAME. The connection is then made to us directly, so we see the visitor's IP
address, user agent and origin just as we do without a proxy. Its certificate
is obtained through our infrastructure provider.

Neither changes what is collected or what we keep about visitors.

## 6. What we add server-side

| Added | Source | Note |
|---|---|---|
| IP address | The request, or a proxy that forwards it (§5) | Used for the lookup and the request's checks, then not stored. What is kept is its network (an IPv4 /24 or IPv6 /40, returned as `ip_network`) and a keyed per-organisation digest that cannot be reversed without our key |
| Continent, country, region, city, time zone, coordinates | Fingerly's own IP database, held on our own servers | City level at most: no postal code is kept, and the event keeps the city's reference point rounded to one decimal place (about 11 km), never the device's position, so this is approximate (coarse) location for the store forms. Event reads return the place without coordinates |
| VPN, proxy, Tor, datacenter, relay and mobile classification; abuse and attack-source flags; ASN, network and organisation names | The same IP database | **Your visitors' IP addresses are not sent to any third party for this lookup.** The database is first-party, read from our own servers' disk, and refreshed daily |
| Page origin, user agent, and your `tag` | The request | The user agent is also parsed into browser, OS and device type |
| `visitor_id` | Minted by us | Never derived from a hash of the signals, never chosen by the client, and scoped to one organisation |
| `suspect_score`, `suspect_level`, and the signals behind them | Our scoring | Every score is stored with the signals and weights that produced it, so it can be explained |

That last row matters if you use the score to make automated decisions about
people, such as refusing a signup or blocking a transaction. Under GDPR Art. 22
you may owe the person an explanation, and the per-event signal breakdown is
what makes one possible.

Every submission, with its signals (from the mobile SDKs, only the fields a
scoring rule reads), a city-level IP answer and the scoring report, is also
kept in an archive for 30 days (§7). The IP address is not archived.

## 7. Retention

| Data | Kept |
|---|---|
| Events, including the IP network and location | 30 days |
| Deferred report index | 30 days |
| IP network per day, aggregated | 30 days |
| Per-visitor daily aggregates, keyed by `visitor_id` | 180 days |
| Aggregate analytics | 45 to 100 days in detail, 800 days as daily totals |
| Short-term velocity state (hashed) | 8 days |
| Device identity index | Until 180 days after the device was last seen, swept hourly |
| Usage and billing records | About 3 years |
| Full submission archive, including deferred reports | 30 days, deleted by the storage's own expiry rule |

The archive keeps each submission with its city-level IP answer and the
scoring report, so the event store can be rebuilt; it is not readable through
the dashboard, and the server API returns only an allow-listed summary of it
(score, triggers, network, place, attestation), never the signals or the
deferred report.

## 8. What we do not do

- No cookies, and no identifier stored by the browser SDK; the mobile SDKs keep
  one install identifier (§3.1), which the app can delete (§3.2)
- No recognition of an app's device from its hardware: on iOS and Android the
  server recognises a device by the stored install ID only, and hardware
  signals serve integrity checks and scoring
- No tracking: the iOS privacy manifest declares `NSPrivacyTracking` false, and
  the SDKs need no App Tracking Transparency prompt
- No precise location: no location services, and IP coordinates rounded to one
  decimal place
- No package names of other apps sent from Android; only whether any of a
  fixed list of root, hooking or cloning apps is installed
- No cross-customer identity graph: a `visitor_id` belongs to one organisation
  and is not shared between customers
- No selling or sharing of visitor data
- No page content, form input, keystrokes, mouse movement or session recording
- No advertising or marketing use of any kind
- No special-category data (Art. 9) collected deliberately

## 9. Related

- [`server/docs/compliance/`](../../server/docs/compliance/README.md): the
  compliance documents. Several describe the architecture before the move to a
  single EU database and carry a banner saying so; where they disagree with this
  page, this page is current.
- [`subprocessors-and-transfers.md`](../../server/docs/compliance/subprocessors-and-transfers.md):
  who else touches the data.
