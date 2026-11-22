# Interaction capture kit

A task page and a tiny local server for recording what the `interaction`
source (ADR 0029, `agentDetection: 'interaction'`) counts while an AI
assistant, or a person, operates a page. The captures are the labelled
fixtures ADR 0029 Decision 6 asks for before any threshold is set.

Nothing here ships. The directory has no `package.json`, so it is not a
workspace package, turbo never builds or tests it, and no published tarball
contains it (`pnpm check:packs` checks the tarballs). Captures are written to
`captures/`, which git ignores.

The page never talks to the Fingerly API. It loads the locally built
script-tag SDK with `agentDetection: 'interaction'` and consent granted, and
calls `collect()`, which runs the sources in the page and returns the report
without sending it (its transport refuses to submit anything). Only the
`interaction` and `automation` sources run. The page then posts the raw
counts, the label and the browser's user agent to the local server.

## 1. Build

From the `sdks` repository root:

```sh
pnpm install                                   # first time only
pnpm exec turbo run build --filter=@fingerly/web-js
```

That builds `@fingerly/types`, `@fingerly/core` and `@fingerly/web-js`, and
leaves the script-tag bundle at `client/web/web-js/dist/browser.global.js`,
which the server serves as `/sdk.js`. Rebuild after any change to the SDK and
reload the page.

## 2. Start

```sh
node client/web/capture/serve.mjs
```

Open <http://localhost:3034>. The server listens on `127.0.0.1:3034` only.
`PORT` changes the port (stay off 3000 to 3010). For touch runs on a phone,
start it with `HOST=0.0.0.0 node client/web/capture/serve.mjs` on a network you
trust and open `http://<this Mac's LAN address>:3034` on the phone.

## 3. Record one run

1. Open the page in the browser under test, in an ordinary window, at its
   normal size.
2. Type the run label into **Run label** (see the conventions below) and,
   if useful, a note.
3. Press **Start run**. That press reads and discards the counts, so the run
   covers only what happens after it. The label and the button lock until the
   run is saved.
4. Hand the page over and keep your hands off the page until the run ends.
   For an assistant, give exactly this prompt, the same every time:

   > Do the task described on this page.

5. The run is saved when **Finish order** is pressed (once per run, however
   often it is pressed). The status line names the file. If the assistant
   gives up or gets stuck, press **Save now (run did not finish)**; that one
   click is counted, and the capture says `"ended_by": "operator"`.
6. Press **Start run** again for the next run.

A harness that opens its own browser can label and start the run from the
URL instead: `http://localhost:3034/?label=<label>&notes=<notes>&start=1`.

Each capture is a new file: `captures/<UTC time>-<label>-<random>.json`. The
server never overwrites one, and a capture is never edited afterwards. A new
assistant release is a new capture.

### Label conventions

`<product> <product version> / <browser> <browser version>`, lower case, for
example `claude-in-chrome 1.2.3 / chrome 142.0.1234.56` with the real
numbers. For people,
`human-<input>`, for example `human-mouse`, `human-trackpad`, `human-touch`,
`human-keyboard`, `human-screenreader-voiceover`, `human-voice-control`,
`human-password-manager-1password`, `human-autofill-chrome`. Put the device
and anything unusual in the note (`MacBook Air M2, external mouse`).

## 4. Assistant runs

Do at least three runs per assistant. Record the product's version from its
own About or settings page, and the browser's from `chrome://version`,
`edge://version` or the equivalent.

| Assistant | How to run it |
| --- | --- |
| Perplexity Comet | Open the page in Comet, label and start the run, open the assistant on the page and give the prompt. |
| Claude in Chrome | In Chrome with the extension installed, open the page, label and start the run, open the Claude side panel on that tab and give the prompt. Allow it to act on `localhost` when it asks. |
| Gemini in Chrome | In Chrome with Gemini in Chrome, open the page, label and start the run, open Gemini on that tab and give the prompt in its agent mode, so it acts rather than only answers. |
| Edge Copilot | In Edge with Copilot Mode on, open the page, label and start the run, open Copilot on the tab and give the prompt with browser actions allowed. |
| browser-use | Run it locally with a visible (headed) browser, following the quick start of the installed version, with the task `Open http://localhost:3034/?label=browser-use%20<version>%20<model>&start=1 and do the task described on the page.` Its cloud browser cannot reach `localhost`. Put the model in the label. |

If an assistant asks for confirmation before a step, confirm in its own panel,
not on the page.

## 5. Human comparison runs (ADR 0029 Decision 6)

The same task, done by a person, once per input method, at least twice each.
These are the false-positive list the server rule has to stay quiet on.

| Label | How |
| --- | --- |
| `human-mouse` | External mouse, typing on the keyboard. |
| `human-trackpad` | Built-in trackpad, typing on the keyboard, scrolling with two fingers. |
| `human-touch` | A phone or tablet (see `HOST` above), tapping and typing on the on-screen keyboard. |
| `human-keyboard` | Keyboard only: Tab and Shift+Tab between fields, Enter or Space on buttons, arrows or Page Down to scroll. Do not touch the mouse or trackpad. |
| `human-screenreader-voiceover` | VoiceOver on (Command+F5), moving with VoiceOver commands only. On Windows, `human-screenreader-nvda` with NVDA. |
| `human-voice-control` | macOS Voice Control (System Settings, Accessibility, Voice Control): "click Full name", dictate the text, "click Step 1", "scroll down". |
| `human-password-manager-<name>` | Fill name and email from a password manager's saved identity, type the rest, click the buttons. |
| `human-autofill-<browser>` | Save Ada Lovelace's name, email and city as an address in the browser first, then pick it from the autofill suggestion. |
| `human-paste` | Copy each value from the task text and paste it with Command+V. |

## What a capture holds

```json
{
  "label": "human-mouse",
  "notes": "MacBook Air M2, external mouse",
  "captured_at": "2026-11-22T08:43:01.600Z",
  "ended_by": "finish",
  "started_by_operator": true,
  "task": { "name_ok": true, "email_ok": true, "city_ok": true, "message_ok": true, "steps_done": 3, "terms_scrolled": true },
  "user_agent": "Mozilla/5.0 ...",
  "interaction": { "span_s": 41, "clicks_mouse": 6, "...": 0 },
  "automation": { "status": "ok", "ms": 0, "value": { "webdriver": false } }
}
```

`interaction` is the source's value exactly as a report carries it.
`automation` is the existing automation source's outcome, kept beside it for
calibration. `task` says whether the run actually did the task, so a failed
run is not mistaken for a successful one. Nothing else is recorded: no
screenshots, no field values, no timings.
