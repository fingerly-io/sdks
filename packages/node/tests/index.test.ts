import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createProxy, load, verifyWebhook } from "../src/index.js";

describe("verifyWebhook", () => {
  it("verifies the raw payload and rejects stale timestamps", () => {
    const payload = '{"ok":true}';
    const timestamp = "1700000000";
    const signature =
      "sha256=" +
      createHmac("sha256", "secret")
        .update(timestamp + "." + payload)
        .digest("hex");
    expect(
      verifyWebhook({
        secret: "secret",
        payload,
        timestamp,
        signature,
        now: new Date(1700000000_000),
      }),
    ).toBe(true);
    expect(
      verifyWebhook({
        secret: "secret",
        payload,
        timestamp,
        signature,
        now: new Date(1700001000_000),
      }),
    ).toBe(false);
  });

  it("accepts any of the signatures sent during a secret rotation", () => {
    const payload = '{"ok":true}';
    const timestamp = "1700000000";
    const sign = (secret: string) =>
      "sha256=" +
      createHmac("sha256", secret)
        .update(timestamp + "." + payload)
        .digest("hex");
    const now = new Date(1700000000_000);
    const header = `${sign("new")},${sign("old")}`;
    expect(
      verifyWebhook({
        secret: "new",
        payload,
        timestamp,
        signature: header,
        now,
      }),
    ).toBe(true);
    expect(
      verifyWebhook({
        secret: "old",
        payload,
        timestamp,
        signature: header,
        now,
      }),
    ).toBe(true);
    expect(
      verifyWebhook({
        secret: "other",
        payload,
        timestamp,
        signature: header,
        now,
      }),
    ).toBe(false);
  });
});

describe("event client", () => {
  it("rejects unsupported keys rather than falling back to the control API", () => {
    for (const secretKey of [
      "not-a-fingerly-key",
      "fly_pk_eu_production_test",
      "fly_px_us_development_test",
      "fly_mk_us_test",
      "fly_sk_eu_unknown_test",
      "fly_sk_us_production_",
    ]) {
      expect(() =>
        load({ secretKey, endpoint: "https://custom.test" }),
      ).toThrow(TypeError);
    }
  });

  it("scopes reads through the secret key and encodes filters", async () => {
    let seen: { url: string; key: string | null } | undefined;
    const client = load({
      secretKey: "fly_sk_us_development_test",
      endpoint: "https://fingerly.test",
      fetchImpl: async (input, init) => {
        seen = {
          url: String(input),
          key: new Headers(init?.headers).get("x-api-key"),
        };
        return Response.json({ rows: [], page: 1, page_size: 20 });
      },
    });
    await client.events.list({ limit: 20, level: "high" });
    expect(seen).toEqual({
      url: "https://fingerly.test/api/v1/events?limit=20&level=high",
      key: "fly_sk_us_development_test",
    });
  });
});

describe("same-origin proxy", () => {
  it("forwards trusted visitor metadata and only accepted SDK paths", async () => {
    let upstream: Request | undefined;
    const proxy = createProxy({
      proxyKey: "fly_px_eu_production_proxy",
      clientIp: () => "203.0.113.10",
      fetchImpl: async (input, init) => {
        upstream = new Request(input, init);
        return Response.json({ request_id: "one" });
      },
    });
    const response = await proxy(
      new Request("https://shop.test/api/fingerly/api/v1/identify", {
        method: "POST",
        headers: {
          origin: "https://shop.test",
          "user-agent": "Firefox",
          "x-api-key": "fly_pk_eu_production_public",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);
    expect(upstream?.url).toBe("https://eu.api.fingerly.io/api/v1/identify");
    expect(upstream?.headers.get("x-fingerly-client-ip")).toBe("203.0.113.10");
    expect(upstream?.headers.get("x-fingerly-origin")).toBe(
      "https://shop.test",
    );
    expect(upstream?.headers.get("x-api-key")).toBe(
      "fly_pk_eu_production_public",
    );
    expect(upstream?.headers.get("x-fingerly-proxy-key")).toBe(
      "fly_px_eu_production_proxy",
    );
    expect(upstream?.headers.get("cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");

    expect(
      (
        await proxy(
          new Request("https://shop.test/api/fingerly/admin", {
            method: "POST",
          }),
        )
      ).status,
    ).toBe(404);
  });

  it("rejects missing public keys and oversized bodies before forwarding", async () => {
    let calls = 0;
    const proxy = createProxy({
      proxyKey: "fly_px_eu_development_proxy",
      maxBodyBytes: 2,
      clientIp: () => "203.0.113.10",
      fetchImpl: async () => {
        calls++;
        return Response.json({});
      },
    });
    expect(
      (
        await proxy(
          new Request("https://shop.test/api/fingerly/api/v1/identify", {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await proxy(
          new Request("https://shop.test/api/fingerly/api/v1/identify", {
            method: "POST",
            headers: { "x-api-key": "fly_pk_eu_development_public" },
            body: "long",
          }),
        )
      ).status,
    ).toBe(413);
    expect(calls).toBe(0);
  });
});
