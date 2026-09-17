/** SDK-owned deadlines cover both fetch and reading its response body. */
export class FingerlyTimeoutError extends Error {
  override readonly name = "FingerlyTimeoutError";
  constructor(readonly operation: "request" | "event_wait" = "request") {
    super(
      operation === "event_wait"
        ? "Timed out waiting for the event"
        : "Fingerly request timed out",
    );
  }
}

export interface APIErrorMetadata {
  code?: string;
  details?: unknown;
  requestId?: string;
}
export class FingerlyAPIError extends Error {
  override readonly name = "FingerlyAPIError";
  readonly code?: string;
  readonly details?: unknown;
  readonly requestId?: string;
  constructor(
    message: string,
    readonly status: number,
    metadata: APIErrorMetadata = {},
  ) {
    super(message);
    if (metadata.code !== undefined) this.code = metadata.code;
    if (metadata.details !== undefined) this.details = metadata.details;
    if (metadata.requestId !== undefined) this.requestId = metadata.requestId;
  }
}

export function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
    throw new TypeError(`${name} must be a positive integer below 2147483648`);
  return value;
}

export async function deadline<T>(
  timeoutMs: number,
  signal: AbortSignal | undefined,
  operation: "request" | "event_wait",
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  positive(timeoutMs, "timeoutMs");
  if (signal?.aborted) throw signal.reason;
  const controller = new AbortController();
  const forward = () => controller.abort(signal!.reason);
  signal?.addEventListener("abort", forward, { once: true });
  const timer = setTimeout(
    () => controller.abort(new FingerlyTimeoutError(operation)),
    timeoutMs,
  );
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  try {
    return await Promise.race([aborted, run(controller.signal)]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}

export function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
