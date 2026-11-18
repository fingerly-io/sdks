import { warmAudio } from './sources/audio.js'
import { warmCodecs } from './sources/device.js'
import { warmVoices } from './sources/text.js'

/**
 * Starts the browser answers that are slow on a cold start: the system voice
 * list, the hardware-decode queries and the audio rendering engine. A browser that has just started can
 * take longer to answer them than a source may wait, and a missing answer
 * changes the profile a private window is recognised by.
 *
 * Called only once collection is permitted (ADR 0024: nothing is read from
 * the device before consent), and at most once per page.
 */
let warmed = false

export function warmSlowSources(): void {
  if (warmed) return
  warmed = true
  warmVoices()
  warmCodecs()
  warmAudio()
}
