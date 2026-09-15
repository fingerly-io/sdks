# Private-browsing validation matrix

Manual runs are recorded here without IP addresses, profile names, or other
visitor-specific values. Quota and usage are diagnostic observations, not
identity material.

## Firefox (2026-09-14)

| Window | Tracking protection | Verdict | OPFS | Service worker | Storage usage |
| --- | --- | --- | --- | --- | --- |
| Normal | Standard | `false` / low | `ok` | available | non-zero |
| Private | Standard | `true` / medium | `refused` | available | zero |
| Normal | Strict | `false` / low | `ok` | available | non-zero |
| Private | Strict | `true` / medium | `refused` | available | zero |

All four runs reported Gecko consistently. The result validates
`firefox-private-origin-filesystem-refused` across both protection modes and
also shows that Strict protection alone must not be interpreted as private
browsing.

Zero storage usage is retained only as a test observation. A fresh normal
profile can also have zero usage, so it is not promoted to a second verdict
reason. Current Firefox also exposes service workers in private windows; the
legacy service-worker reason remains useful only for older releases and custom
history policies. Until another signal separates a fresh normal profile from a
private one independently, OPFS remains the sole modern Gecko verdict signal.

## Safari 26.5 on macOS (2026-09-14)

| Window | Verdict | OPFS | Storage quota | Storage usage | Service worker |
| --- | --- | --- | --- | --- | --- |
| Normal | `false` / low | `ok` | 82,463,372,084 | 0 | available |
| Private | `true` / medium | `transient` | 1,048,576,000 | 25,899,753 | available |

Both runs claimed and observed WebKit consistently, and both submitted all 13
deferred sources. The private-window OPFS rejection is represented by the
collector as `transient` and produces the stable verdict reason
`safari-private-origin-filesystem-refused`.

The quota difference is retained as supporting test evidence, not as an
additional verdict rule. Quotas can vary with disk capacity and browser policy;
the OPFS behavior is the measured discriminator.

## Safari 26.0 on iOS 26 Simulator (2026-09-14)

| Window | Verdict | OPFS | Storage quota | Storage usage | Service worker |
| --- | --- | --- | --- | --- | --- |
| Normal | `false` / low | `ok` | 41,231,686,042 | 0 | available |
| Private | `true` / medium | `transient` | 1,048,576,000 | 0 | available |

Both runs completed all 36 sources under the simulator probe bench's enlarged
5-second budget: 32 were `ok` and four correctly reported unsupported APIs.
Both claimed and observed WebKit consistently. The same
`safari-private-origin-filesystem-refused` rule validated on macOS therefore
also separates normal and private Mobile Safari in the iOS simulator.

The web `emulator` verdict remained false by design. Mobile Safari exposes a
real-iPhone-shaped browser surface in Simulator: five touch points, a coarse
pointer without hover, DPR 3, motion APIs, and an `Apple GPU` WebGL renderer.
Those values cannot distinguish Simulator from a physical iPhone without false
positives. The native iOS SDK is the authoritative layer for this question and
detects `targetEnvironment(simulator)` directly at high confidence.

## Tor Browser (Firefox 140 ESR) on macOS (2026-09-14)

| Security level | Tor verdict | Incognito verdict | Clock | Canvas | Prompt after fix |
| --- | --- | --- | --- | --- | --- |
| Standard | `true` / medium or high | `true` / high | 16.667ms or 100ms | guarded / blocked | no |
| Safest | `true` / high | `true` / high | 100ms | guarded / blocked | no readback attempted |

Both levels letterboxed the viewport and disabled service-worker registration.
The regular Tor window correctly reads as incognito because Tor applies
private-session storage behavior; this does not require opening a separate
private window.

The first Standard run exposed a compatibility defect: current Tor sometimes
uses a 16.667ms timer clamp, while the canvas prompt guard only recognized the
historical 100ms clamp. The collector consequently attempted readback and Tor
opened its canvas permission doorhanger. The guard now recognizes both measured
profiles and aborts before creating a canvas. A fresh-identity Standard rerun
produced `rfp-canvas-prompt-avoided`, showed no prompt, and retained the Tor
verdict. Both clock profiles are pinned by behavioral regression tests.

## Still requiring physical/manual coverage

- Physical-iPhone confirmation of Safari normal/private behavior
- A second independent modern Firefox signal, if one becomes available without
  increasing false positives
