import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import openapiTS, { astToString } from "openapi-typescript";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(
  process.env.FINGERLY_CONTRACT_DIR ?? resolve(root, "contract"),
);
const check = process.argv.includes("--check");
const manifest = JSON.parse(readFileSync(resolve(source, "manifest.json")));
const outputs = new Map();
for (const name of ["openapi.json", "fixtures.json"]) {
  const raw = readFileSync(resolve(source, name));
  if (createHash("sha256").update(raw).digest("hex") !== manifest.files[name])
    throw new Error(`Invalid contract hash: ${name}`);
  outputs.set(`contract/${name}`, raw);
}
outputs.set(
  "contract/manifest.json",
  readFileSync(resolve(source, "manifest.json")),
);
const types = astToString(
  await openapiTS(JSON.parse(outputs.get("contract/openapi.json"))),
);
outputs.set("src/generated/contract.ts", Buffer.from(types));
for (const [name, raw] of outputs) {
  const target = resolve(root, name);
  if (check) {
    if (!readFileSync(target).equals(raw))
      throw new Error(`${name} is stale; run contract:sync`);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, raw);
  }
}
console.log(
  check
    ? "Node contract snapshot is current."
    : "Node contract snapshot refreshed.",
);
