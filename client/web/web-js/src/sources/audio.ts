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

interface AudioProbeReading {
  sum: number
  crestRatio: number | undefined
  shapeRatio: number | undefined
  decayRatio: number | undefined
  negativeSamples: number
}

/**
 * Render the probe signal once and return the summed buffer together with
 * scale-invariant ratios over `[4500..5000)`.
 *
 * The oscillator and compressor settings are arbitrary but fixed: what matters
 * is that they are the same on every device forever, because the value is only
 * comparable against other runs of exactly this graph. Changing any constant
 * here invalidates every stored audio fingerprint, so they are written out
 * rather than derived.
 *
 * Brave's standard audio farbling multiplies every sample by one per-session
 * constant `fudge_factor` in `[0.999, 1.0)`. Homogeneous degree-0 ratios
 * (`sum / maxAbs`, `sqrt(sumSq) / sum`, `earlySum / lateSum`) cancel that
 * scalar exactly, while `negativeSamples === 0` exposes Brave's strict-mode
 * non-negative LFSR replacement (`(v / UINT64_MAX) / 10`).
 */
async function render(ctx: SourceContext): Promise<AudioProbeReading> {
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
  let sumSq = 0
  let maxAbs = 0
  let earlySum = 0
  let lateSum = 0
  let negativeSamples = 0
  // From 4500 rather than 0: the compressor's attack is still settling before
  // that, and the early samples are where throttled or suspended contexts
  // differ from ordinary slow ones for reasons that are about scheduling
  // rather than about the device.
  const mid = 4500 + Math.floor(Math.max(0, samples.length - 4500) / 2)
  for (let i = 4500; i < samples.length; i++) {
    const raw = samples[i] ?? 0
    if (raw < 0) negativeSamples++
    const abs = Math.abs(raw)
    sum += abs
    sumSq += abs * abs
    if (abs > maxAbs) maxAbs = abs
    if (i < mid) earlySum += abs
    else lateSum += abs
  }
  return {
    sum,
    crestRatio: sum > 0 && maxAbs > 0 ? sum / maxAbs : undefined,
    shapeRatio: sum > 0 ? Math.sqrt(sumSq) / sum : undefined,
    decayRatio: earlySum > 0 && lateSum > 0 ? earlySum / lateSum : undefined,
    negativeSamples,
  }
}

/**
 * Starts the browser's audio rendering engine with a tiny silent render, so
 * the probe is not the first render of a browser that has just started: on a
 * cold start the first render took longer than the source may wait, and a
 * missing audio value leaves a phone too few components to be identified.
 * Its result is discarded. Reads only after consent.
 */
export function warmAudio(): void {
  attempt(() => {
    const w = globalThis as unknown as {
      OfflineAudioContext?: OfflineContextConstructor
      webkitOfflineAudioContext?: OfflineContextConstructor
    }
    const OfflineContext = w.OfflineAudioContext ?? w.webkitOfflineAudioContext
    if (!OfflineContext) return
    const started = new OfflineContext(1, 128, 44100).startRendering()
    if (started && typeof started.catch === 'function') started.catch(() => undefined)
  })
}

export const audioSource: Source<AudioSignal> = {
  id: SOURCE.audio,
  stage: 'collect',
  // A phone's one component that tells two identical models apart: it may
  // run into the scheduler's grace period on a cold start.
  identityCritical: true,
  timeoutMs: 750,
  async run(ctx) {
    const first = await render(ctx)

    // A context that renders nothing at all has been suspended rather than
    // merely being unsupported - iOS does this until a user gesture, and
    // several privacy builds do it permanently.
    if (first.sum === 0) throw new BlockedSignal('audio-silent')

    const second = await render(ctx)
    const unstable = first.sum !== second.sum

    return compact<AudioSignal>({
      value: first.sum,
      crest_ratio: unstable ? undefined : first.crestRatio,
      shape_ratio: unstable ? undefined : first.shapeRatio,
      decay_ratio: unstable ? undefined : first.decayRatio,
      negative_samples: first.negativeSamples,
      unstable,
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
  stage: 'collect',
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
        max_channels: attempt(() => context.destination?.maxChannelCount),
        state: attempt(() => context.state),
      })
    } finally {
      // Closing matters: a live AudioContext holds an audio device open, and
      // leaving one per page load behind is a real leak on mobile.
      attempt(() => void context.close())
    }
  },
}
