import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

test("structured probe output is complete before an immediate process exit", () => {
  const module = new URL("../worker/codex-rate-probe-output.mjs", import.meta.url).href;
  const script = `import { writeRateProbeResult } from ${JSON.stringify(module)};
    writeRateProbeResult({ marker: "example".repeat(200000) });
    process.exit(19);`;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      new URL("./no-network.js", import.meta.url).pathname,
      "--input-type=module",
      "-e",
      script,
    ],
    {
      encoding: "utf8",
      env: {},
      maxBuffer: 4 * 1024 * 1024,
      timeout: 10000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 19);
  assert.equal(result.stderr.length, 0);
  const expected = JSON.stringify({ marker: "example".repeat(200000) });
  assert.equal(result.stdout.length, expected.length);
  assert.equal(
    createHash("sha256").update(result.stdout).digest("hex"),
    createHash("sha256").update(expected).digest("hex"),
  );
});
