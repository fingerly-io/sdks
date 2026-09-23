# What the SDKs collect

Written for the integrator, and for the privacy notice they have to write.

If you are embedding a fingerly SDK, you are the controller for the data it
collects about your visitors and we are your processor. That means the notice,
the legal basis and the consent are yours to get right — and you cannot do any
of it without knowing exactly what the code reads. This document is that list.

> **Status.** The consent plumbing described in §4 does not exist yet. Today
> every SDK collects unconditionally as soon as it is initialised. Read §4
> before shipping to EU or UK visitors; it describes what you must do around the
> SDK until the SDK does it for you.

## 1. The short version

The SDKs read characteristics of the device and browser in order to recognise
the same device across visits and to judge whether it is being misrepresented.
They do not read page content, form fields, keystrokes, mouse movement,
clipboard, contacts, photos, location services, or anything belonging to the
person rather than to the device.

What leaves the device is a set of signal values and their derived hashes. What
we add server-side is an IP-derived location and network classification, and a
risk score.

## 2. Browser (`web-js` and the framework bindings)

Thirteen source modules, roughly 22 signals. Grouped by what they read:

| Module | What it reads |
|---|---|
| `audio` | AudioContext rendering characteristics, sample rate, base latency, channel count |
| `render` | Canvas and WebGL rendering output characteristics, GPU vendor/renderer strings |
| `text` | Font availability and text measurement metrics |
| `display` | Screen geometry, colour depth, pixel ratio |
| `device` | Hardware concurrency, device memory, touch and pointer capability, motion/orientation availability |
| `navigator` | Platform, language, timezone, cookie-enabled flag, and similar declared properties |
| `engine` | JavaScript engine behavioural characteristics |
| `runtime` | Runtime environment characteristics |
| `storage` | Whether localStorage, sessionStorage and IndexedDB are available and writable |
| `durability` | IndexedDB commit timing, used to detect private-browsing modes |
| `dom` | Probes for elements blocked by common ad/tracker filter lists |
| `shields` | Privacy-hardening and anti-detection browser characteristics |
| `lies` | Consistency checks — whether the browser is misreporting any of the above |

Two things worth stating plainly, because a privacy reviewer will ask.

**The `dom` module probes for blocked elements**, including selectors used by
cookie-consent banners, to infer which filter lists are active. That is a
fingerprinting signal derived from the visitor's privacy choices. If that is not
acceptable in your deployment, raise it with us — it is a signal, not a
foundation.

**The `lies` module exists to detect tampering.** It is what lets us tell a
genuinely privacy-hardened browser apart from an anti-detect browser
impersonating a normal one. It is also the reason our identity layer treats
unstable signals as carrying no identity information, which means hardened
browsers are not punished by being re-identified as new visitors on every page
load.

### 2.1 Storage

The SDK does **not** write cookies, localStorage, sessionStorage or IndexedDB
entries of its own. It reads whether those APIs work as a signal; it does not
persist an identifier on the device.

This matters for your notice: there is no fingerly cookie to list. The
identifier is minted server-side and is not stored on the visitor's device.
It does not remove the ePrivacy Art. 5(3) question — *reading* device
characteristics is in scope regardless of whether anything is written — but it
does mean the SDK leaves no trace on the device.

## 3. Mobile (`ios`, `android`, and the React Native / Flutter bridges)

The native SDKs read device and OS characteristics, integrity indicators
(jailbreak/root, emulator, hooking framework presence), and hardware
configuration. Android requests two install-time permissions, which prompt
nobody.

The React Native and Flutter packages are bridges, not reimplementations — they
call the native SDKs, so the collection surface is whichever native platform
they are running on. Do not assume the JavaScript or Dart surface bounds what is
collected.

## 4. Consent — what you must do today

**The SDK has no consent parameter yet.** Until it does:

1. **Gate initialisation yourself.** Do not load or call the SDK until you have
   the lawful basis you have decided on. Once it is called, collection has
   happened and cannot be retracted.
2. **Treat this as in scope for ePrivacy Art. 5(3).** Reading device
   characteristics is "gaining access to information stored in terminal
   equipment" — the EDPB's Guidelines 2/2023 confirm fingerprinting is covered.
   Whether fraud prevention qualifies for the strictly-necessary exemption is
   contested; take your own advice, and be aware that the conservative reading
   requires consent.
3. **Disclose it.** Your privacy notice needs to name device fingerprinting for
   fraud prevention, name us as a processor, and say how long the data is kept.
4. **Tell us about erasure requests.** The self-service route is not built yet;
   contact us and we will handle it manually until it is.

When consent support ships, it will be a required argument at every entry point,
defaulting to deny when absent, propagated into the submission envelope and
enforced server-side — so an integration that is careful today will need only to
pass through what it already knows.

## 5. What we add server-side

| Added | Source | Note |
|---|---|---|
| IP address | The request | Stored at full precision for 30 days |
| Country, continent, region, city | A geolocation database on our own servers | No request leaves our infrastructure to produce it |
| VPN / proxy / Tor / datacenter / relay / mobile classification, ASN, network name | An IP intelligence provider | **Your visitors' IP addresses are sent to this provider.** It is named, with what it receives and where, in our sub-processor list |
| `visitor_id` | Minted by us | Never derived from a hash of the signals, and never chosen by the client |
| `suspect_score`, `suspect_level`, and the signals behind them | Our scoring | Every score is stored with the signals and weights that produced it, so it can be explained |

That last row matters if you use the score to make automated decisions about
people — refusing a signup, blocking a transaction. Under GDPR Art. 22 you may
owe the person an explanation, and the per-event signal breakdown is what makes
one possible.

## 6. Retention

| Data | Kept |
|---|---|
| Raw events, including IP | 30 days |
| Per-IP daily aggregates | 90 days — under review |
| Aggregate analytics | 45–100 days hot, up to 800 days aggregated |
| Usage and billing records | ~3 years |
| Device identity index | Currently unbounded — a 180-day inactivity window is being implemented |
| Full submission archive | Currently unbounded — a lifecycle rule is being implemented |

The last two rows are known gaps and are the top of our remediation list. They
are stated here rather than omitted because you may not want to make a retention
promise in your own notice that our storage does not yet keep.

## 7. What we do not do

- No cookies, no device-side storage, no cross-customer identity graph — a
  `visitor_id` is scoped to one organisation and is not shared between customers
- No selling or sharing of visitor data
- No page content, form input, keystrokes, mouse movement or session recording
- No advertising or marketing use of any kind
- No special-category data (Art. 9) collected deliberately

## 8. Related

- [`server/docs/compliance/`](../../server/docs/compliance/README.md) — the full compliance program
- [`data-inventory.md`](../../server/docs/compliance/data-inventory.md) — every field, every store
- [`subprocessors-and-transfers.md`](../../server/docs/compliance/subprocessors-and-transfers.md) — who else touches it
