import { createHmac, timingSafeEqual } from "node:crypto";

import {
  credential as credentialInfo,
  endpointForKey,
  endpoint as normalizeEndpoint,
} from "./credentials.js";
import { deadline, pause, positive, FingerlyAPIError } from "./http.js";
export { FingerlyAPIError, FingerlyTimeoutError } from "./http.js";
export type { APIErrorMetadata } from "./http.js";

import type { components } from "./generated/contract.js";
export type EventTrigger = components["schemas"]["EventTriggerOut"];
// Keep the stable SDK type names and nullable score semantics. Archive contents
// deliberately remain opaque rather than becoming a second public contract.
export type Event = Omit<
  components["schemas"]["SDKEventOut"],
  "suspect_score" | "document" | "deferred_signals"
> & {
  suspect_score: number | null;
  document?: unknown;
  deferred_signals?: Record<string, unknown>;
};

export interface EventListOptions {
  from?: Date | string;
  to?: Date | string;
  page?: number;
  limit?: number;
  visitor?: string;
  level?: "low" | "medium" | "high";
  signal?: AbortSignal;
}
export type EventPage = Omit<components["schemas"]["SDKEventsOut"], "rows"> & {
  rows: Event[];
};
export interface FingerlyOptions {
  secretKey: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}
export interface WaitForOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

function instant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function load(options: FingerlyOptions) {
  const regionalEndpoint = endpointForKey(options.secretKey, "sk");
  const endpoint = normalizeEndpoint(options.endpoint ?? regionalEndpoint);
  const timeoutMs = positive(options.timeoutMs ?? 5_000, "timeoutMs");
  const request = <T>(path: string, signal?: AbortSignal): Promise<T> =>
    deadline(timeoutMs, signal, "request", async (bounded) => {
      const response = await (options.fetchImpl ?? globalThis.fetch)(
        endpoint + path,
        {
          headers: {
            "x-api-key": options.secretKey,
            accept: "application/json",
          },
          redirect: "manual",
          signal: bounded,
        },
      );
      if (!response.ok) {
        // Only expose the structured, documented error fields; never raw bodies.
        let body: {
          error?: { code?: unknown; details?: unknown };
          request_id?: unknown;
        } = {};
        try {
          body = await response.json();
        } catch {
          /* Non-JSON errors still carry their HTTP status. */
        }
        const metadata: import("./http.js").APIErrorMetadata = {};
        if (typeof body?.error?.code === "string")
          metadata.code = body.error.code
            .split(options.secretKey)
            .join("[redacted]");
        if (body?.error?.details !== undefined)
          metadata.details = JSON.parse(
            JSON.stringify(body.error.details)
              .split(options.secretKey)
              .join("[redacted]"),
          );
        if (typeof body?.request_id === "string")
          metadata.requestId = body.request_id
            .split(options.secretKey)
            .join("[redacted]");
        throw new FingerlyAPIError(
          `Fingerly API returned HTTP ${response.status}`,
          response.status,
          metadata,
        );
      }
      return (await response.json()) as T;
    });
  const get = (requestId: string, signal?: AbortSignal) =>
    request<Event>(`/api/v1/events/${encodeURIComponent(requestId)}`, signal);
  return {
    events: {
      list: (query: EventListOptions = {}) => {
        const params = new URLSearchParams();
        if (query.from !== undefined) params.set("from", instant(query.from));
        if (query.to !== undefined) params.set("to", instant(query.to));
        if (query.page !== undefined) params.set("page", String(query.page));
        if (query.limit !== undefined) params.set("limit", String(query.limit));
        if (query.visitor !== undefined) params.set("visitor", query.visitor);
        if (query.level !== undefined) params.set("level", query.level);
        const suffix = params.size === 0 ? "" : `?${params}`;
        return request<EventPage>(`/api/v1/events${suffix}`, query.signal);
      },
      get,
      waitFor: (
        requestId: string,
        wait: WaitForOptions = {},
      ): Promise<Event> => {
        const interval = positive(wait.intervalMs ?? 250, "intervalMs");
        return deadline(
          wait.timeoutMs ?? 10_000,
          wait.signal,
          "event_wait",
          async (signal) => {
            for (;;) {
              try {
                return await get(requestId, signal);
              } catch (error) {
                if (!(
                  error instanceof FingerlyAPIError &&
                  error.status === 404 &&
                  error.code === "event_not_found"
                ))
                  throw error;
              }
              await pause(interval, signal);
            }
          },
        );
      },
    },
  };
}

export interface VerifyWebhookOptions {
  secret: string;
  payload: string | Uint8Array;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  toleranceSeconds?: number;
  now?: Date;
}

/**
 * Verify the raw request body before parsing it.
 *
 * While an endpoint's secret is being rotated the signature header carries one
 * signature per secret, comma-separated, and a match on any of them is valid.
 */
export function verifyWebhook(options: VerifyWebhookOptions): boolean {
  const tolerance = options.toleranceSeconds ?? 300;
  const seconds = Number(options.timestamp);
  if (
    !options.secret ||
    !options.signature ||
    !options.timestamp ||
    !/^\d+$/.test(options.timestamp) ||
    !Number.isSafeInteger(seconds) ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  )
    return false;
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - seconds) > tolerance) return false;
  const body = Buffer.from(options.payload);
  const expected = Buffer.from(
    createHmac("sha256", options.secret)
      .update(`${options.timestamp}.`)
      .update(body)
      .digest("hex"),
  );
  return options.signature.split(",").some((candidate) => {
    const value = candidate.trim();
    if (!/^sha256=[a-f0-9]{64}$/.test(value)) return false;
    const actual = Buffer.from(value.slice("sha256=".length));
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  });
}

export interface ProxyOptions {
  /** Write-only credential created for customer-owned proxy infrastructure. */
  proxyKey?: string;
  /** @deprecated Use proxyKey. Secret read keys will be refused in the next major version. */
  secretKey?: string;
  upstream?: string;
  prefix?: string;
  maxBodyBytes?: number;
  timeoutMs?: number;
  /** Resolve the visitor address only from infrastructure your app trusts. */
  clientIp(request: Request): string | Promise<string>;
  fetchImpl?: typeof fetch;
}

/** Framework-neutral same-origin proxy for identify and supplement POSTs. */
export function createProxy(
  options: ProxyOptions,
): (request: Request) => Promise<Response> {
  if (!options.proxyKey && !options.secretKey)
    throw new TypeError("A Fingerly proxy key is required");
  if (options.proxyKey && options.secretKey)
    throw new TypeError("Pass proxyKey or deprecated secretKey, not both");
  const credential = options.proxyKey ?? options.secretKey!;
  const expected = options.proxyKey ? "px" : "sk";
  const proxyCredential = credentialInfo(credential, expected);
  const upstream = normalizeEndpoint(
    options.upstream ?? endpointForKey(credential, expected),
  );
  const prefix = (options.prefix ?? "/api/fingerly").replace(/\/+$/, "");
  const maxBodyBytes = positive(
    options.maxBodyBytes ?? 1_048_576,
    "maxBodyBytes",
  );
  const timeoutMs = positive(options.timeoutMs ?? 5_000, "timeoutMs");
  if (!prefix.startsWith("/") || prefix.includes("?") || prefix.includes("#"))
    throw new TypeError("prefix must be an absolute URL path");
  if (typeof options.clientIp !== "function")
    throw new TypeError("clientIp is required");
  return async (request: Request) => {
    if (request.method !== "POST")
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "POST" },
      });
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith(prefix + "/api/v1/"))
      return new Response("Not Found", { status: 404 });
    const tail = incoming.pathname.slice(prefix.length);
    if (
      tail !== "/api/v1/identify" &&
      !/^\/api\/v1\/events\/[^/]+\/supplement$/.test(tail)
    )
      return new Response("Not Found", { status: 404 });
    const publicKey = request.headers.get("x-api-key");
    if (options.proxyKey) {
      try {
        const presented = credentialInfo(publicKey ?? "", "pk");
        if (
          presented.region !== proxyCredential.region ||
          presented.environment !== proxyCredential.environment
        )
          return new Response("Unauthorized", { status: 401 });
      } catch {
        return new Response("Unauthorized", { status: 401 });
      }
    }
    if (Number(request.headers.get("content-length")) > maxBodyBytes)
      return new Response("Payload Too Large", { status: 413 });
    return deadline(timeoutMs, request.signal, "request", async (bounded) => {
      const reader = request.body?.getReader();
      const cancel = () => {
        void reader?.cancel(bounded.reason).catch(() => {});
      };
      bounded.addEventListener("abort", cancel, { once: true });
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        if (reader)
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > maxBodyBytes) {
              await reader.cancel();
              return new Response("Payload Too Large", { status: 413 });
            }
            chunks.push(chunk.value);
          }
      } finally {
        bounded.removeEventListener("abort", cancel);
        reader?.releaseLock();
      }
      const body = Buffer.concat(chunks);
      const headers = new Headers({
        "content-type":
          request.headers.get("content-type") ?? "application/json",
        "x-api-key": options.proxyKey ? publicKey! : credential,
        "x-fingerly-client-ip": await options.clientIp(request),
        "x-fingerly-origin": request.headers.get("origin") ?? incoming.origin,
        "x-fingerly-user-agent": request.headers.get("user-agent") ?? "",
      });
      if (options.proxyKey)
        headers.set("x-fingerly-proxy-key", options.proxyKey);
      const idempotency = request.headers.get("idempotency-key");
      if (idempotency) headers.set("idempotency-key", idempotency);
      const response = await (options.fetchImpl ?? globalThis.fetch)(
        upstream + tail,
        {
          method: "POST",
          headers,
          body,
          redirect: "manual",
          signal: bounded,
        },
      );
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("cache-control", "no-store");
      const bytes = await response.arrayBuffer();
      return new Response(
        [204, 205, 304].includes(response.status) ? null : bytes,
        {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        },
      );
    });
  };
}
