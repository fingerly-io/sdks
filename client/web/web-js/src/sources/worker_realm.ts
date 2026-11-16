/**
 * CSP-safe isolated `Blob` DedicatedWorkerGlobalScope collector (`worker_realm`).
 *
 * Anti-detect extensions and page-injected scripts frequently override
 * `window.navigator` and `WebGLRenderingContext` in the main document realm
 * while forgetting `DedicatedWorkerGlobalScope` (or vice-versa).
 *
 * Safety & CSP invariants:
 * 1. Pre-checks `<meta http-equiv="Content-Security-Policy">` (`worker-src` ->
 *    `child-src` -> `default-src`). When `blob:` is disallowed, throws
 *    `BlockedSignal('csp-meta')` without invoking `new Worker`.
 * 2. Memoizes CSP `SecurityError` / `securitypolicyviolation` per page session
 *    so strict-CSP HTTP headers never emit repeat violation reports.
 * 3. Bounds worker execution to `60ms`, explicitly loses any temporary
 *    `OffscreenCanvas` WebGL context inside the worker before posting, and
 *    always calls `worker.terminate()` and `URL.revokeObjectURL(blobUrl)` in
 *    `finally`.
 */

import {
  BlockedSignal,
  SOURCE,
  TimedOutSignal,
  UnsupportedSignal,
  type Source,
  type WorkerRealmSignal,
} from '@fingerly/core'

import { attempt, compact, requireWindow } from '../util.js'

const WORKER_TIMEOUT_MS = 60

let sessionCspBlocked = false

/** Test-only helper to clear the session-memoized CSP `SecurityError` flag. */
export function resetWorkerRealmCspCache(): void {
  sessionCspBlocked = false
}

const WORKER_SCRIPT = `(function () {
  var out = {};
  try {
    if (typeof navigator !== 'undefined') {
      if (typeof navigator.userAgent === 'string') out.user_agent = navigator.userAgent;
      if (typeof navigator.platform === 'string') out.platform = navigator.platform;
      if (typeof navigator.hardwareConcurrency === 'number') out.hardware_concurrency = navigator.hardwareConcurrency;
      if (typeof navigator.deviceMemory === 'number') out.device_memory = navigator.deviceMemory;
      if (Array.isArray(navigator.languages)) out.languages = Array.prototype.slice.call(navigator.languages);
    }
  } catch (_) {}
  try {
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === 'string' && tz) out.timezone = tz;
  } catch (_) {}
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      var canvas = new OffscreenCanvas(1, 1);
      var gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
      if (gl) {
        try {
          var dbg = gl.getExtension('WEBGL_debug_renderer_info');
          if (dbg) {
            var vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
            var renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
            if (typeof vendor === 'string' && vendor) out.unmasked_vendor = vendor;
            if (typeof renderer === 'string' && renderer) out.unmasked_renderer = renderer;
          }
        } finally {
          try {
            var lose = gl.getExtension('WEBGL_lose_context');
            if (lose && typeof lose.loseContext === 'function') lose.loseContext();
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
  self.postMessage(out);
})();`

function policyAllowsBlobWorker(policyText: string): boolean {
  const directives = new Map<string, string[]>()
  for (const rawPart of policyText.split(';')) {
    const trimmed = rawPart.trim()
    if (!trimmed) continue
    const tokens = trimmed.split(/\s+/).map((token) => token.toLowerCase())
    const name = tokens[0]
    if (name && !directives.has(name)) {
      directives.set(name, tokens.slice(1))
    }
  }

  const effective =
    directives.get('worker-src') ?? directives.get('child-src') ?? directives.get('default-src')
  if (!effective) return true

  return effective.some((token) => token === 'blob:' || token.startsWith('blob:'))
}

function metaCspDisallowsBlobWorker(doc: Document | undefined): boolean {
  if (!doc || typeof doc.querySelectorAll !== 'function') return false
  const metas = attempt(() => Array.from(doc.querySelectorAll('meta[http-equiv]')))
  if (!metas) return false

  for (const meta of metas) {
    const equiv = meta.getAttribute('http-equiv')?.trim().toLowerCase()
    if (equiv !== 'content-security-policy') continue
    const content = meta.getAttribute('content')
    if (typeof content === 'string' && !policyAllowsBlobWorker(content)) {
      return true
    }
  }
  return false
}

function isCspSecurityError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'SecurityError') return true
  const msg = error.message.toLowerCase()
  return msg.includes('content security policy') || msg.includes('securityerror')
}

function normalizeWorkerPayload(raw: unknown): WorkerRealmSignal {
  if (!raw || typeof raw !== 'object') return {}
  const data = raw as Record<string, unknown>
  return compact<WorkerRealmSignal>({
    user_agent: typeof data.user_agent === 'string' ? data.user_agent : undefined,
    platform: typeof data.platform === 'string' ? data.platform : undefined,
    hardware_concurrency:
      typeof data.hardware_concurrency === 'number' && Number.isFinite(data.hardware_concurrency)
        ? data.hardware_concurrency
        : undefined,
    device_memory:
      typeof data.device_memory === 'number' && Number.isFinite(data.device_memory)
        ? data.device_memory
        : undefined,
    languages: Array.isArray(data.languages)
      ? data.languages.filter((item): item is string => typeof item === 'string')
      : undefined,
    timezone: typeof data.timezone === 'string' ? data.timezone : undefined,
    unmasked_vendor: typeof data.unmasked_vendor === 'string' ? data.unmasked_vendor : undefined,
    unmasked_renderer:
      typeof data.unmasked_renderer === 'string' ? data.unmasked_renderer : undefined,
  })
}

export const workerRealmSource: Source<WorkerRealmSignal> = {
  id: SOURCE.workerRealm,
  stage: 'collect',
  embeddedSafe: true,
  timeoutMs: 80,
  async run(ctx) {
    const w = requireWindow()
    const doc = attempt(() => w.document)

    if (metaCspDisallowsBlobWorker(doc)) {
      throw new BlockedSignal('csp-meta')
    }

    if (sessionCspBlocked) {
      throw new BlockedSignal('csp-blocked')
    }

    if (
      typeof Worker !== 'function' ||
      typeof Blob !== 'function' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function' ||
      typeof URL.revokeObjectURL !== 'function'
    ) {
      throw new UnsupportedSignal('no-worker')
    }

    const blobUrl = URL.createObjectURL(new Blob([WORKER_SCRIPT], { type: 'text/javascript' }))
    let worker: Worker | undefined
    let onCspViolation: ((event: Event) => void) | undefined

    try {
      try {
        worker = new Worker(blobUrl)
      } catch (error) {
        if (isCspSecurityError(error)) {
          sessionCspBlocked = true
          throw new BlockedSignal('csp-blocked')
        }
        throw error
      }

      const activeWorker = worker
      const raw = await new Promise<unknown>((resolve, reject) => {
        let settled = false
        const settle = (fn: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          ctx.signal?.removeEventListener('abort', onAbort)
          if (doc && onCspViolation) {
            doc.removeEventListener('securitypolicyviolation', onCspViolation)
          }
          fn()
        }

        const onAbort = () =>
          settle(() => reject(ctx.signal?.reason ?? new TimedOutSignal('aborted')))
        const timer = setTimeout(
          () => settle(() => reject(new TimedOutSignal('worker-timeout'))),
          WORKER_TIMEOUT_MS,
        )

        ctx.signal?.addEventListener('abort', onAbort, { once: true })

        onCspViolation = (event: Event) => {
          const spv = event as SecurityPolicyViolationEvent
          const directive = (spv.effectiveDirective || spv.violatedDirective || '').toLowerCase()
          const blockedUri = (spv.blockedURI || '').toLowerCase()
          if (
            blockedUri.startsWith('blob') ||
            directive.startsWith('worker-src') ||
            directive.startsWith('child-src') ||
            directive.startsWith('default-src')
          ) {
            sessionCspBlocked = true
            settle(() => reject(new BlockedSignal('csp-blocked')))
          }
        }
        doc?.addEventListener('securitypolicyviolation', onCspViolation)

        activeWorker.onmessage = (event: MessageEvent) => {
          settle(() => resolve(event?.data))
        }
        activeWorker.onerror = (event: ErrorEvent) => {
          event?.preventDefault?.()
          const message = String(event?.message ?? '').toLowerCase()
          if (message.includes('content security policy') || message.includes('securityerror')) {
            sessionCspBlocked = true
            settle(() => reject(new BlockedSignal('csp-blocked')))
            return
          }
          settle(() => reject(new BlockedSignal('worker-error')))
        }
      })

      return normalizeWorkerPayload(raw)
    } finally {
      if (doc && onCspViolation) {
        attempt(() => doc.removeEventListener('securitypolicyviolation', onCspViolation!))
      }
      attempt(() => worker?.terminate())
      attempt(() => URL.revokeObjectURL(blobUrl))
    }
  },
}
