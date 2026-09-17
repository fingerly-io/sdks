import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  load,
  verifyWebhook,
  type Event,
  type EventPage,
} from "../src/index.js";
const spec = JSON.parse(
  readFileSync(new URL("../contract/openapi.json", import.meta.url), "utf8"),
);
const fixtures = JSON.parse(
  readFileSync(new URL("../contract/fixtures.json", import.meta.url), "utf8"),
);
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
ajv.addSchema(spec, "fingerly");

describe("server-owned contract fixtures", () => {
  for (const fixture of fixtures.responses)
    it(`validates ${fixture.name} against the public schema`, async () => {
      const validate = ajv.compile({
        $ref: `fingerly#/components/schemas/${fixture.schema}`,
      });
      expect(validate(fixture.body), JSON.stringify(validate.errors)).toBe(
        true,
      );
      const client = load({
        secretKey: "fly_sk_us_development_contract",
        fetchImpl: async () =>
          Response.json(fixture.body, { status: fixture.status }),
      });
      if (fixture.status !== 200)
        await expect(client.events.get("id")).rejects.toMatchObject({
          status: fixture.status,
          code: fixture.body.error.code,
        });
      else if (fixture.schema === "SDKEventsOut") {
        const page: EventPage = await client.events.list();
        expect(page).toEqual(fixture.body);
      } else {
        const event: Event = await client.events.get("id");
        expect(event).toEqual(fixture.body);
      }
    });
  for (const fixture of fixtures.webhooks)
    it(`verifies server signing fixture ${fixture.name}`, () => {
      expect(
        verifyWebhook({
          secret: fixture.secret,
          payload: fixture.payload,
          timestamp: fixture.timestamp,
          signature: fixture.signature,
          now: new Date(Number(fixture.timestamp) * 1000),
        }),
      ).toBe(fixture.valid);
    });
  it("rejects a stale server signing fixture", () => {
    const fixture = fixtures.webhooks[0];
    expect(
      verifyWebhook({
        ...fixture,
        now: new Date((Number(fixture.timestamp) + 301) * 1000),
      }),
    ).toBe(false);
  });
});
