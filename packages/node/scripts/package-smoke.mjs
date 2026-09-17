import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const work = mkdtempSync(resolve(tmpdir(), "fingerly-node-package-"));
try {
  execFileSync('pnpm', ['build'], { stdio: 'inherit' });
  execFileSync("pnpm", ["pack", "--pack-destination", work], {
    stdio: "inherit",
  });
  const packed = readdirSync(work).find((name) => name.endsWith(".tgz"));
  if (!packed) throw new Error("Package artifact was not created");
  writeFileSync(
    resolve(work, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      resolve(work, packed),
    ],
    { cwd: work, stdio: "inherit" },
  );
  const assertions = `if (typeof sdk.load !== 'function' || typeof sdk.createProxy !== 'function' || typeof sdk.verifyWebhook !== 'function' || typeof sdk.FingerlyTimeoutError !== 'function') throw new Error('Missing exports'); const c = sdk.load({secretKey:'fly_sk_us_development_smoke'}); if(typeof c.events.waitFor !== 'function') throw new Error('Missing waitFor');`;
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import * as sdk from '@fingerly/node'; ${assertions}`,
    ],
    { cwd: work, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [
      "--input-type=commonjs",
      "-e",
      `const sdk = require('@fingerly/node'); ${assertions}`,
    ],
    { cwd: work, stdio: "inherit" },
  );
  const pkg = JSON.parse(
    readFileSync(resolve(work, "node_modules/@fingerly/node/package.json")),
  );
  if (
    pkg.version !== "0.1.0" ||
    (pkg.dependencies && Object.keys(pkg.dependencies).length)
  )
    throw new Error("Unexpected package version or runtime dependencies");
  console.log("Packed package installs and imports as ESM and CommonJS.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
