/**
 * The audio stack.
 *
 * An `OfflineAudioContext` rendering a fixed signal through a compressor
 * produces a buffer whose sum differs by platform, by audio driver, and
 * occasionally by CPU. It is one of the highest-entropy signals available to a
 * page and it needs no permission - nothing is played and no microphone is
 * touched.
 *
 * As with canvas, it is rendered twice and compared. Safari 17 and Brave both
 * noise the output. Skipping the source on those browsers would throw away the
 * fact that the browser is noising it, and that fact is worth more than the
 * number.
 */

import {
  BlockedSignal,
  SOURCE,
  UnsupportedSignal,
  type AudioSignal,
  type Source,
  type SourceContext,
} from '@fingerly/core'

import { attempt, compact } from '../util.js'

type OfflineContextConstructor = new (
  channels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContext

function offlineConstructor(): OfflineContextConstructor {
  const w = globalThis as unknown as {
    OfflineAudioContext?: OfflineContextConstructor
    webkitOfflineAudioContext?: OfflineContextConstructor
  }
  const ctor = w.OfflineAudioContext ?? w.webkitOfflineAudioContext
  if (!ctor) throw new UnsupportedSignal('no-offline-audio-context')
  return ctor
}

/**
 * Render the probe signal once and return the summed buffer.
 *
 * The oscillator and compressor settings are arbitrary but fixed: what matters
 * is that they are the same on every device forever, because the value is only
 * comparable against other runs of exactly this graph. Changing any constant
 * here invalidates every stored audio fingerprint, so they are written out
 * rather than derived.
 */
async function render(ctx: SourceContext): Promise<number> {
  const OfflineContext = offlineConstructor()
  const context = new OfflineContext(1, 5000, 44100)

  const oscillator = context.createOscillator()
  oscillator.type = 'triangle'
  oscillator.frequency.value = 10000

  const compressor = context.createDynamicsCompressor()
  compressor.threshold.value = -50
  compressor.knee.value = 40
  compressor.ratio.value = 12
  compressor.attack.value = 0
  compressor.release.value = 0.25

  oscillator.connect(compressor)
  compressor.connect(context.destination)
  oscillator.start(0)

  const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
    ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true })
    context.oncomplete = (event) => resolve(event.renderedBuffer)
    try {
      const started = context.startRendering()
      // Older WebKit returns undefined and only fires `oncomplete`; newer
      // engines return a promise. Both are handled rather than assuming one.
      if (started && typeof started.then === 'function') started.then(resolve, reject)
    } catch (error) {
      reject(error)
    }
  })

  const samples = buffer.getChannelData(0)
  let sum = 0
  // From 4500 rather than 0: the compressor's attack is still settling before
  // that, and the early samples are where throttled or suspended contexts
  // differ from ordinary slow ones for reasons that are about scheduling
  // rather than about the device.
  for (let i = 4500; i < samples.length; i++) sum += Math.abs(samples[i] ?? 0)
  return sum
}

export const audioSource: Source<AudioSignal> = {
  id: SOURCE.audio,
  tier: 'deferred',
  timeoutMs: 500,
  async run(ctx) {
    const first = await render(ctx)

    // A context that renders nothing at all has been suspended rather than
    // merely being unsupported - iOS does this until a user gesture, and
    // several privacy builds do it permanently.
    if (first === 0) throw new BlockedSignal('audio-silent')

    const second = await render(ctx)

    return compact<AudioSignal>({
      value: first,
      unstable: first !== second,
      sample_rate: 44100,
    })
  },
}

/**
 * `AudioContext.baseLatency`, which is a property of the output device rather
 * than of the rendering graph, and so is a separate signal from the one above.
 *
 * Its own source because it needs a *live* context rather than an offline one,
 * and a live context is the thing browsers suspend.
 */
export const audioLatencySource: Source<AudioSignal> = {
  id: SOURCE.audioLatency,
  tier: 'deferred',
  timeoutMs: 200,
  run() {
    const w = globalThis as unknown as {
      AudioContext?: new () => AudioContext
      webkitAudioContext?: new () => AudioContext
    }
    const Ctor = w.AudioContext ?? w.webkitAudioContext
    if (!Ctor) throw new UnsupportedSignal('no-audio-context')

    const context = new Ctor()
    try {
      return compact<AudioSignal>({
        base_latency: attempt(() => context.baseLatency),
        sample_rate: attempt(() => context.sampleRate),
        state: attempt(() => context.state),
      })
    } finally {
      // Closing matters: a live AudioContext holds an audio device open, and
      // leaving one per page load behind is a real leak on mobile.
      attempt(() => void context.close())
    }
  },
}
