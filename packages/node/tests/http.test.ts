import { describe, expect, it, vi } from "vitest";
import {
  load,
  createProxy,
  FingerlyAPIError,
  FingerlyTimeoutError,
  verifyWebhook,
} from "../src/index.js";
const key = "fly_sk_us_development_test";
const missing = () =>
  Response.json(
    {
      error: { code: "event_not_found", message: "Not found", status: 404 },
      request_id: "trace",
    },
    { status: 404 },
  );
const event = { request_id: "stored", suspect_score: null };

describe("bounded event reads", () => {
  it("infers only regional endpoints and does not follow redirects", async () => {
    for (const region of ["us", "eu"]) {
      let target = "";
      let redirect: RequestRedirect | undefined;
      const client = load({
        secretKey: `fly_sk_${region}_development_test`,
        fetchImpl: async (url, init) => {
          target = String(url);
          redirect = init?.redirect;
          return Response.json(event);
        },
      });
      await client.events.get("id/a");
      expect(target).toBe(
        `https://${region}.api.fingerly.io/api/v1/events/id%2Fa`,
      );
      expect(redirect).toBe("manual");
    }
  });
  it("preserves structured error metadata and the old constructor", async () => {
    const client = load({ secretKey: key, fetchImpl: async () => missing() });
    await expect(client.events.get("missing")).rejects.toMatchObject({
      status: 404,
      code: "event_not_found",
      requestId: "trace",
    });
    expect(new FingerlyAPIError("old", 400).status).toBe(400);
  });
  it("handles non-JSON errors and does not expose bodies or credentials", async () => {
    const client = load({
      secretKey: key,
      fetchImpl: async () => new Response(key, { status: 502 }),
    });
    await expect(client.events.get("missing")).rejects.toMatchObject({
      status: 502,
      message: "Fingerly API returned HTTP 502",
    });
  });
  it("times out a fetch even when an injected implementation ignores cancellation", async () => {
    const client = load({
      secretKey: key,
      timeoutMs: 20,
      fetchImpl: () => new Promise(() => {}),
    });
    await expect(client.events.get("missing")).rejects.toBeInstanceOf(
      FingerlyTimeoutError,
    );
  });
  it("keeps the deadline active while receiving the body", async () => {
    const client = load({
      secretKey: key,
      timeoutMs: 20,
      fetchImpl: async () => new Response(new ReadableStream({ start() {} })),
    });
    await expect(client.events.get("missing")).rejects.toBeInstanceOf(
      FingerlyTimeoutError,
    );
  });
  it("preserves external cancellation and sends no request after pre-abort", async () => {
    const controller = new AbortController();
    const reason = new Error("customer cancelled");
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    const client = load({ secretKey: key, fetchImpl });
    const read = client.events.get("id", controller.signal);
    controller.abort(reason);
    await expect(read).rejects.toBe(reason);
    fetchImpl.mockClear();
    await expect(client.events.get("id", controller.signal)).rejects.toBe(
      reason,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("does not silently retry get or list", async () => {
    const fetchImpl = vi.fn(async () => missing());
    const client = load({ secretKey: key, fetchImpl });
    await expect(client.events.get("id")).rejects.toBeInstanceOf(
      FingerlyAPIError,
    );
    await expect(client.events.list()).rejects.toBeInstanceOf(FingerlyAPIError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("rejects invalid deadlines and endpoints", () => {
    for (const timeoutMs of [0, -1, NaN, Infinity, 1.5, 2 ** 31])
      expect(() => load({ secretKey: key, timeoutMs })).toThrow(TypeError);
    for (const endpoint of [
      "file:///private",
      "https://user:pass@host",
      "https://host?key=value",
    ])
      expect(() => load({ secretKey: key, endpoint })).toThrow();
  });
});

describe("explicit eventual-consistency polling", () => {
  it("waits through structured missing responses until the event exists", async () => {
    let count = 0;
    const client = load({
      secretKey: key,
      fetchImpl: async () => (++count < 3 ? missing() : Response.json(event)),
    });
    expect(await client.events.waitFor("id", { intervalMs: 1 })).toEqual(event);
    expect(count).toBe(3);
  });
  it("bounds permanently missing events with one total deadline", async () => {
    const client = load({ secretKey: key, fetchImpl: async () => missing() });
    await expect(
      client.events.waitFor("id", { timeoutMs: 20, intervalMs: 5 }),
    ).rejects.toMatchObject({
      name: "FingerlyTimeoutError",
      operation: "event_wait",
    });
  });
  it("does not retry other errors, unstructured 404s or transport failures", async () => {
    for (const status of [400, 401, 403, 429, 500, 404]) {
      const fetchImpl = vi.fn(async () =>
        Response.json({ error: { code: "other" } }, { status }),
      );
      await expect(
        load({ secretKey: key, fetchImpl }).events.waitFor("id"),
      ).rejects.toMatchObject({ status });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
    const error = new Error("offline");
    const fetchImpl = vi.fn(async () => {
      throw error;
    });
    await expect(
      load({ secretKey: key, fetchImpl }).events.waitFor("id"),
    ).rejects.toBe(error);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("cancels polling immediately and cleans up cancellation listeners", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const fetchImpl = vi.fn(async () => missing());
    const read = load({ secretKey: key, fetchImpl }).events.waitFor("id", {
      intervalMs: 1000,
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort(new Error("stop"));
    await expect(read).rejects.toThrow("stop");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(add.mock.calls.length).toBe(remove.mock.calls.length);
  });
});

describe("proxy boundary", () => {
  it("refuses invalid proxy options and mismatched public credentials", async () => {
    expect(() =>
      createProxy({ proxyKey: key, clientIp: () => "127.0.0.1" }),
    ).toThrow(TypeError);
    const fetchImpl = vi.fn(async () => Response.json({}));
    const proxy = createProxy({
      proxyKey: "fly_px_us_development_test",
      clientIp: () => "127.0.0.1",
      fetchImpl,
    });
    for (const publicKey of [
      "fly_pk_eu_development_test",
      "fly_pk_us_production_test",
      key,
      "invalid",
    ]) {
      const r = await proxy(
        new Request("https://shop.test/api/fingerly/api/v1/identify", {
          method: "POST",
          headers: { "x-api-key": publicKey },
          body: "{}",
        }),
      );
      expect(r.status).toBe(401);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("bounds upstream body receipt and propagates external cancellation", async () => {
    const proxy = createProxy({
      secretKey: key,
      timeoutMs: 20,
      clientIp: () => "127.0.0.1",
      fetchImpl: async () => new Response(new ReadableStream({ start() {} })),
    });
    await expect(
      proxy(
        new Request("https://shop.test/api/fingerly/api/v1/identify", {
          method: "POST",
          body: "{}",
        }),
      ),
    ).rejects.toBeInstanceOf(FingerlyTimeoutError);
  });
});

describe("webhook malformed input", () => {
  it("rejects missing/noncanonical timestamps, tampering and invalid tolerance", () => {
    for (const timestamp of [
      null,
      undefined,
      "",
      " ",
      "1.5",
      "-1",
      "0x10",
      "Infinity",
    ])
      expect(
        verifyWebhook({
          secret: "secret",
          payload: "{}",
          timestamp,
          signature: "sha256=" + "0".repeat(64),
        }),
      ).toBe(false);
    expect(
      verifyWebhook({
        secret: "secret",
        payload: "{}",
        timestamp: "1",
        signature: "sha256=" + "0".repeat(64),
        toleranceSeconds: NaN,
      }),
    ).toBe(false);
  });
});
