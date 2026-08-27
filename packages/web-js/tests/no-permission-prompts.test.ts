/**
 * The SDK must never make the browser ask its user anything.
 *
 * This is enforced by a test rather than by review because it is the kind of
 * rule that survives exactly as long as everyone remembers it. A permission
 * dialog on a checkout page has destroyed the thing the fraud check was
 * protecting, and a visitor who is asked has been told they are being measured.
 *
 * The test reads the shipped source rather than mocking a browser: mocking
 * would only prove that the mocked APIs were not called, whereas a spelling of
 * `getUserMedia` anywhere in the tree is a defect regardless of which branch
 * reaches it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BlockedSignal, SOURCE, type SourceContext } from '@badele/core'
import { describe, expect, it } from 'vitest'

import { canvasSource } from '../src/sources/render.js'

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src')

/**
 * APIs that put a dialog, a doorhanger, or a picker in front of the user.
 *
 * Deliberately not a list of "APIs behind a permission" - reading a permission's
 * state prompts nobody. `permissions.query()` is specified never to prompt and
 * `enumerateDevices()` returns unlabelled devices rather than asking, so both
 * are used freely. Requesting is what is banned.
 */
const FORBIDDEN: [pattern: RegExp, what: string][] = [
  [/\bgetUserMedia\b/, 'camera/microphone prompt'],
  [/\bgetDisplayMedia\b/, 'screen-share prompt'],
  [/\brequestPermission\b/, 'Notification/DeviceMotion permission prompt'],
  [/\bgetCurrentPosition\b|\bwatchPosition\b/, 'geolocation prompt'],
  [/storage\s*\.\s*persist\b/, 'persistent-storage prompt'],
  [/\brequestStorageAccess\b/, 'storage-access prompt'],
  [/\bshowOpenFilePicker\b|\bshowSaveFilePicker\b|\bshowDirectoryPicker\b/, 'file picker'],
  [/\brequestDevice\b|\brequestPort\b/, 'bluetooth/usb/hid/serial chooser'],
  [/credentials\s*\.\s*(get|create)\b/, 'credential prompt'],
  [/\brequestMIDIAccess\b/, 'MIDI prompt'],
  [/\brequestFullscreen\b|\brequestPointerLock\b/, 'fullscreen/pointer-lock grab'],
  [/wakeLock\s*\.\s*request\b/, 'wake-lock request'],
  [/\bIdleDetector\b/, 'idle-detection prompt'],
  [/clipboard\s*\.\s*(read|write)/, 'clipboard prompt'],
  [/\bshare\s*\(/, 'web-share sheet'],
  [/\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/, 'blocking dialog'],
]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

/**
 * Strip comments before matching.
 *
 * The rule is documented in prose beside the code it governs - `source.ts`
 * names every banned API in its doc comment - and a test that could not tell
 * documentation from a call site would forbid explaining itself.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('no source may prompt the user', () => {
  const files = sourceFiles(SRC)

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it.each(FORBIDDEN)('never calls %s (%s)', (pattern, what) => {
    const offenders = files.filter((file) => pattern.test(code(readFileSync(file, 'utf8'))))
    expect(offenders, `${what} reachable from: ${offenders.join(', ')}`).toEqual([])
  })
})

/**
 * Canvas is the API that prompts on one browser and not the others.
 *
 * Tor Browser raises a doorhanger on `toDataURL()`; everyone else answers
 * silently. The blanket rule above cannot catch it, because the call is
 * legitimate - it is the *unguarded* call that is the defect.
 *
 * Asserted behaviourally rather than by reading the file. The readback lives in
 * helpers declared above the guard, so source order says nothing about call
 * order; what matters is whether a canvas is ever created. `createElement` is
 * therefore booby-trapped: if the guard works, it is never reached.
 */
describe('canvas readback under resistFingerprinting', () => {
  const withFakeDom = async (nowResolution: number) => {
    let createdElement = false

    const document = {
      createElement: () => {
        createdElement = true
        throw new Error('the canvas source touched the DOM')
      },
    }

    const globals = globalThis as Record<string, unknown>
    const saved = { window: globals.window, document: globals.document }
    globals.window = { document }
    globals.document = document

    const ctx: SourceContext = {
      signal: new AbortController().signal,
      budgetRemainingMs: () => 1000,
      completed: (id) =>
        id === SOURCE.timing
          ? { status: 'ok', ms: 1, value: { has_performance: true, now_resolution: nowResolution } }
          : undefined,
    }

    try {
      const thrown = await Promise.resolve()
        .then(() => canvasSource.run(ctx))
        .then(
          () => undefined,
          (error: unknown) => error,
        )
      return { thrown, createdElement }
    } finally {
      globals.window = saved.window
      globals.document = saved.document
    }
  }

  it('declines without touching the canvas when the clock is clamped to 100ms', async () => {
    const { thrown, createdElement } = await withFakeDom(100)

    expect(thrown).toBeInstanceOf(BlockedSignal)
    expect((thrown as BlockedSignal).reason).toBe('rfp-canvas-prompt-avoided')

    // The point of the whole test: no canvas was created, so no doorhanger
    // could have been raised.
    expect(createdElement).toBe(false)
  })

  it('still collects on an ordinary browser, proving the guard is not blanket', async () => {
    // 0.1ms is Chromium's clamp. The source must get as far as the DOM here -
    // the booby trap firing is the pass condition.
    const { createdElement } = await withFakeDom(0.1)
    expect(createdElement).toBe(true)
  })
})
