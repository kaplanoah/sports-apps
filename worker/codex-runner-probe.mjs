import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TOOL_PROOF = "TRUSTED_CODEX_TOOL_PROOF_OK";
export const CAPTURE_PROOF = "TRUSTED_CODEX_CAPTURE_PROOF";

/** @param {{ uid: number, environment: Record<string, string | undefined>, sudoStatus: () => number | null, writeCheckout: () => unknown }} checks */
export function assertCodexSandbox({ uid, environment, sudoStatus, writeCheckout }) {
  assert.notEqual(uid, 0);
  for (const name of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "TRIAL_SECRET_CANARY",
  ])
    assert.equal(Object.hasOwn(environment, name), false);
  assert.notEqual(sudoStatus(), 0);
  assert.throws(writeCheckout);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assertCodexSandbox({
    uid: process.getuid(),
    environment: process.env,
    sudoStatus: () => spawnSync("sudo", ["-n", "true"]).status,
    writeCheckout: () =>
      writeFileSync(new URL("./checkout/forbidden-write.txt", import.meta.url), "blocked"),
  });
  console.log(TOOL_PROOF);
  console.error(CAPTURE_PROOF);
}
