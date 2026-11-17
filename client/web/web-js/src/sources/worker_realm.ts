/**
 * CSP-safe isolated `Blob` DedicatedWorkerGlobalScope collector (`worker_realm`).
 *
 * Anti-detect extensions and page-injected scripts frequently override
 * `window.navigator` and `WebGLRenderingContext` in the main document realm
 * while forgetting `DedicatedWorkerGlobalScope` (or vice-versa).
 *
 * Statuses, kept distinct so the server can weigh each one (`WEB-03`):
 * - `unsupported` / `no-worker`: the page has no `Worker`, `Blob` or
 *   `URL.createObjectURL`.
 * - `blocked` / `csp-meta`: starting the worker was refused, and a
 *   `<meta http-equiv="Content-Security-Policy">` that is a child of `<head>`
 *   disallows `blob:` workers. A `<meta>` anywhere else is not an enforced
 *   policy and is ignored, and a `<meta>` alone never stops the attempt: the
 *   attempt is what shows the policy is real.
 * - `blocked` / `csp-blocked`: starting the worker was refused by a policy
 *   delivered some other way (an HTTP header).
 * - `blocked` / `worker-error`: the worker started and then failed.
 * - `timeout` / `worker-timeout`: the worker did not answer in time.
 *
 * `Worker`, `Blob` and `URL.createObjectURL` are read from the page, so the
 * integrity layer inspects all three (`lies/natives.ts`).
 *
 * Safety & CSP invariants:
 * 1. Memoizes a CSP refusal per page session so a strict policy produces at
 *    most one violation per page, never one per call.
 * 2. Waits for the answer for as long as the collection budget allows (up to
 *    `WORKER_WAIT_MS`). A cold worker start on a
 *    busy page takes longer than the old fixed 60 ms limit, so a clean page
 *    timed out on its first call.
 * 3. Explicitly loses any temporary `OffscreenCanvas` WebGL context inside the
 *    worker before posting, and always calls `worker.terminate()` and
 *    `URL.revokeObjectURL(blobUrl)` in `finally`.
 * 4. In the embedded WebView profile (`WEB-07`) the worker reads only its user
 *    agent and platform: no core count, memory, languages, time zone or GPU.
 */

import {
  BlockedSignal,
  SOURCE,
  TimedOutSignal,
  UnsupportedSignal,
  type Source,
  type WorkerRealmSignal,
} from '@fingerly/core'

import { detectEmbedding } from '../embedding.js'
import { attempt, compact, requireWindow } from '../util.js'

/**
 * The longest wait for the worker's answer. The actual wait is whatever is
 * left of the collection budget (less a small margin so the source reports
 * `worker-timeout` itself), capped here.
 */
const WORKER_WAIT_MS = 330
const WORKER_WAIT_FLOOR_MS = 60
const WORKER_WAIT_MARGIN_MS = 15

function workerWaitMs(budgetRemainingMs: number): number {
  const left = Number.isFinite(budgetRemainingMs) ? budgetRemainingMs - WORKER_WAIT_MARGIN_MS : WORKER_WAIT_MS
  return Math.max(WORKER_WAIT_FLOOR_MS, Math.min(WORKER_WAIT_MS, left))
}

let sessionCspBlocked: 'csp-meta' | 'csp-blocked' | undefined

/** Test-only helper to clear the session-memoized CSP `SecurityError` flag. */
export function resetWorkerRealmCspCache(): void {
  sessionCspBlocked = undefined
}

function workerScript(full: boolean): string {
  return `(function (full) {
  var out = {};
  try {
    if (typeof navigator !== 'undefined') {
      if (typeof navigator.userAgent === 'string') out.user_agent = navigator.userAgent;
      if (typeof navigator.platform === 'string') out.platform = navigator.platform;
      if (full && typeof navigator.hardwareConcurrency === 'number') out.hardware_concurrency = navigator.hardwareConcurrency;
      if (full && typeof navigator.deviceMemory === 'number') out.device_memory = navigator.deviceMemory;
      if (full && Array.isArray(navigator.languages)) out.languages = Array.prototype.slice.call(navigator.languages);
    }
  } catch (_) {}
  if (!full) { self.postMessage(out); return; }
  try {
    var tz0 = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz0 === 'string' && tz0) out.timezone = tz0;
  } catch (_) {}
  // The navigator values first: a first WebGL context can take longer than
  // the whole collection budget on a cold page.
  self.postMessage({ partial: true, values: out });
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
})(${full ? 'true' : 'false'});`
}

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

/**
 * Whether a CSP `<meta>` that the browser enforces disallows `blob:` workers.
 * A policy `<meta>` is applied only when it is a child of `<head>`; one in
 * `<body>` (or anywhere else) is not a policy and is ignored (`WEB-03`).
 */
function headMetaDisallowsBlobWorker(doc: Document | undefined): boolean {
  const head = attempt(() => doc?.head)
  if (!head) return false
  const children = attempt(() => Array.from(head.children))
  if (!children) return false

  for (const meta of children) {
    if (attempt(() => meta.tagName.toLowerCase()) !== 'meta') continue
    const equiv = attempt(() => meta.getAttribute('http-equiv')?.trim().toLowerCase())
    if (equiv !== 'content-security-policy') continue
    const content = attempt(() => meta.getAttribute('content'))
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

function normalizeWorkerPayload(raw: unknown, full: boolean): WorkerRealmSignal {
  if (!raw || typeof raw !== 'object') return {}
  const data = raw as Record<string, unknown>
  const user_agent = typeof data.user_agent === 'string' ? data.user_agent : undefined
  const platform = typeof data.platform === 'string' ? data.platform : undefined
  if (!full) return compact<WorkerRealmSignal>({ user_agent, platform })
  return compact<WorkerRealmSignal>({
    user_agent,
    platform,
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
    gpu_unanswered: data.gpu_unanswered === true ? true : undefined,
  })
}

export const workerRealmSource: Source<WorkerRealmSignal> = {
  id: SOURCE.workerRealm,
  stage: 'collect',
  embeddedSafe: true,
  timeoutMs: WORKER_WAIT_MS + WORKER_WAIT_MARGIN_MS + 5,
  async run(ctx) {
    const w = requireWindow()
    const doc = attempt(() => w.document)

    if (sessionCspBlocked) {
      throw new BlockedSignal(sessionCspBlocked)
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

    // The head policy names the refusal; it never prevents the attempt.
    const refusal: 'csp-meta' | 'csp-blocked' = headMetaDisallowsBlobWorker(doc)
      ? 'csp-meta'
      : 'csp-blocked'
    const refused = () => {
      sessionCspBlocked = refusal
      return new BlockedSignal(refusal)
    }

    const full = !detectEmbedding()
    const blobUrl = URL.createObjectURL(new Blob([workerScript(full)], { type: 'text/javascript' }))
    let worker: Worker | undefined
    let onCspViolation: ((event: Event) => void) | undefined

    try {
      try {
        worker = new Worker(blobUrl)
      } catch (error) {
        if (isCspSecurityError(error)) throw refused()
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
        // When the wait ends, yield once more before giving up: on a busy page
        // the worker's answer can already be queued behind the main thread.
        // If only the first message arrived, report it with `gpu_unanswered`.
        let partial: Record<string, unknown> | undefined
        const timer = setTimeout(() => {
          setTimeout(
            () =>
              settle(() =>
                partial
                  ? resolve({ ...partial, gpu_unanswered: true })
                  : reject(new TimedOutSignal('worker-timeout')),
              ),
            0,
          )
        }, workerWaitMs(attempt(() => ctx.budgetRemainingMs()) ?? WORKER_WAIT_MS))

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
            settle(() => reject(refused()))
          }
        }
        doc?.addEventListener('securitypolicyviolation', onCspViolation)

        activeWorker.onmessage = (event: MessageEvent) => {
          const data = event?.data as { partial?: unknown; values?: unknown } | undefined
          if (data && data.partial === true) {
            partial = data.values && typeof data.values === 'object' ? (data.values as Record<string, unknown>) : {}
            return
          }
          settle(() => resolve(event?.data))
        }
        activeWorker.onerror = (event: ErrorEvent) => {
          event?.preventDefault?.()
          const message = String(event?.message ?? '').toLowerCase()
          // An enforced head policy that disallows blob workers explains a
          // start-up error, whatever message the browser gives it.
          if (
            refusal === 'csp-meta' ||
            message.includes('content security policy') ||
            message.includes('securityerror')
          ) {
            settle(() => reject(refused()))
            return
          }
          settle(() => reject(new BlockedSignal('worker-error')))
        }
      })

      return normalizeWorkerPayload(raw, full)
    } finally {
      if (doc && onCspViolation) {
        attempt(() => doc.removeEventListener('securitypolicyviolation', onCspViolation!))
      }
      attempt(() => worker?.terminate())
      attempt(() => URL.revokeObjectURL(blobUrl))
    }
  },
}
