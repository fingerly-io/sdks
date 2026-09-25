# What the SDKs collect

Written for the integrator, and for the privacy notice they have to write.

If you are embedding a Fingerly SDK, you are the controller for the data it
collects about your visitors and we are your processor. That means the notice,
the legal basis and the consent are yours to get right, and you cannot do any
of it without knowing exactly what the code reads, stores and sends. This
document is that list, checked against the code on 2026-09-25.

> **Read §4 before shipping to visitors in the EU or UK.** Every SDK has a
> `consent` option, but it defaults to `granted`, and the server neither
> records nor enforces it. An integration that does nothing collects as soon
> as it is initialised.

## 1. The short version

The SDKs read characteristics of the device and browser in order to recognise
the same device across visits and to judge whether it is being misrepresented.
They do not read page content, form fields, keystrokes, mouse movement,
clipboard, contacts, photos, location services, or anything belonging to the
person rather than to the device.

What leaves the device is a set of signal values. What we add server-side is an
IP-derived location and network classification, a visitor identifier and a risk
score. The browser SDK leaves nothing behind on the device; the mobile SDKs keep
one install identifier (§3.1).

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
| Environment | `shields`, `timing`, `permissions`, `automation` | Privacy-hardened browser markers, clock resolution, the **state** of the notification and geolocation permissions, and automation markers (headless browsers, WebDriver, Selenium and Playwright globals) |
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

The native SDKs read operating system and hardware characteristics (model,
memory, CPU, display, storage totals, locale, accessibility settings, battery
and thermal state, audio route, network interfaces including VPN tunnels and
proxies), app installation details (bundle, signing), security settings
(whether a passcode is set, whether biometrics are enrolled), and integrity
indicators (jailbreak or root, emulator, debugger, hooking frameworks such as
Frida, loaded libraries, cloned apps on Android).

The React Native, Flutter and Lynx packages are bridges, not reimplementations:
they call the native SDKs, so what is collected is whatever the native platform
they run on collects. Do not assume the JavaScript or Dart surface bounds it.

### 3.1 What the mobile SDKs store and send

| | iOS | Android |
|---|---|---|
| Stored on the device | One Keychain item (service `io.fingerly.sdk.install`) holding a random install ID, the first-seen time and a launch count. Device-only, so not in backups, and it **survives uninstall**, deliberately, to detect reinstalls | SharedPreferences file `io.fingerly.sdk.install` with a random install ID, first-seen time, launch count and signing signature. Removed on uninstall |
| Platform identifier sent | `identifierForVendor`, as is | `ANDROID_ID`, hashed |
| Calls other than to Fingerly | A DeviceCheck token from Apple (deferred tier) | Key attestation in the Android Keystore, with a key created and deleted in the same run |
| Connection probe | Opens a TLS connection to the configured endpoint to inspect its certificate chain | The same |
| Permissions | None requested | `INTERNET` and `ACCESS_NETWORK_STATE`, which prompt nobody, plus a `<queries>` list naming 17 root, hooking and cloner packages (no `QUERY_ALL_PACKAGES`) |

**iOS privacy manifest.** The iOS SDK does not ship a `PrivacyInfo.xcprivacy`
yet. It uses required-reason APIs in the file timestamp, system boot time and
disk space categories, and App Store Connect flags uploads without a
declaration. This is being fixed; until it is, expect the warning on upload.

## 4. Consent: what you must do

Every SDK and binding takes a `consent` option: `'granted'`, `'pending'` or
`'denied'`, changeable later with `setConsent()`.

- **It defaults to `granted`.** If you pass nothing, the SDK collects as soon as
  it is initialised.
- With `'pending'` or `'denied'`, nothing is collected: loading reads nothing,
  and `identify()` and `collect()` throw a `ConsentError` (`consent_required`)
  before any source runs.
- Withdrawing consent mid-call stops what is still running: the browser SDK
  aborts the sources and the submission in flight and skips the deferred report;
  the mobile SDKs check again before each source and before submitting.
- **The server does not record or enforce it.** Consent is decided in the SDK
  and is not part of the submission, so our side cannot tell an identification
  made with consent from one made without.

So, for visitors in the EU or UK:

1. **Initialise with `consent: 'pending'`** and call `setConsent('granted')` only
   once you have the lawful basis you have decided on. Anything collected before
   that cannot be retracted.
2. **Treat fingerprinting as in scope for ePrivacy Art. 5(3).** Reading device
   characteristics is "gaining access to information stored in terminal
   equipment", and the EDPB's Guidelines 2/2023 confirm fingerprinting is
   covered. Whether fraud prevention qualifies for the strictly-necessary
   exemption is contested; take your own advice, and be aware that the
   conservative reading requires consent.
3. **Disclose it.** Your notice needs to name device fingerprinting for fraud
   prevention, name us as a processor, and say how long the data is kept (§7).
4. **Send erasure requests to us.** There is no self-service or API route to
   delete a visitor's data yet; contact us and we handle it manually.

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
| IP address | The request, or a proxy that forwards it (§5) | Stored at full precision |
| Continent, country, region, city, coordinates | A geolocation database on our own servers | Falls back to the IP intelligence provider below for an address the database has no entry for |
| VPN, proxy, Tor, datacenter, relay and mobile classification; ASN, network, ISP and organisation names | An IP intelligence provider | **Your visitors' IP addresses are sent to this provider**, except private-range addresses. Answers are cached in memory for up to an hour. The provider is named, with what it receives and where, in our sub-processor list |
| Page origin, user agent, and your `tag` | The request | The user agent is also parsed into browser, OS and device type |
| `visitor_id` | Minted by us | Never derived from a hash of the signals, never chosen by the client, and scoped to one organisation |
| `suspect_score`, `suspect_level`, and the signals behind them | Our scoring | Every score is stored with the signals and weights that produced it, so it can be explained |

That last row matters if you use the score to make automated decisions about
people, such as refusing a signup or blocking a transaction. Under GDPR Art. 22
you may owe the person an explanation, and the per-event signal breakdown is
what makes one possible.

Every submission, with its signals exactly as sent, the IP lookup and the
scoring report, is also kept in an archive (§7).

## 7. Retention

| Data | Kept |
|---|---|
| Events, including IP address and location | 30 days |
| Deferred report index | 30 days |
| IP address per day, aggregated | 90 days |
| Per-visitor daily aggregates, keyed by `visitor_id` | 400 days |
| Aggregate analytics | 45 to 100 days in detail, 800 days as daily totals |
| Short-term velocity state (hashed) | 8 days |
| Device identity index | Until 180 days after the device was last seen, swept hourly |
| Usage and billing records | About 3 years |
| **Full submission archive**, including deferred reports | **Not yet bounded**: no expiry rule exists yet |

The last row is a known gap and the top of our remediation list. It is stated
rather than omitted because you should not promise a retention period in your
own notice that our storage does not yet keep.

## 8. What we do not do

- No cookies, and no identifier stored by the browser SDK; the mobile SDKs keep
  one install identifier (§3.1)
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
