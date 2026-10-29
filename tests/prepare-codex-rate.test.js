import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  packageNativeRateControls,
  bundleNativeRateControls,
} from "../worker/prepare-codex-rate.mjs";
import { readNativeRateInput } from "../worker/codex-rate-runtime.mjs";
import { readNativeRatePolicyHash } from "../worker/codex-rate-policy.mjs";

test("native transport input contains only its bound controls and has a verifiable original bundle hash", () => {
  const folder = mkdtempSync(join(tmpdir(), "native-rate-package-test-"));
  try {
    const archive = join(folder, "input.tgz");
    const identity = {
      source: "a".repeat(40),
      run: 12,
      repository: "example/repo",
      portion: "2",
      token: "fake-private-value",
    };
    packageNativeRateControls(archive, identity);
    const names = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
      .trim()
      .split("\n")
      .sort();
    assert.deepEqual(names, [
      "native-rate-input/",
      "native-rate-input/manifest.json",
      "native-rate-input/runtime.mjs",
    ]);
    execFileSync("tar", ["-xzf", archive, "-C", folder]);
    const bundle = join(folder, "native-rate-input/runtime.mjs");
    const manifest = JSON.parse(
      readFileSync(join(folder, "native-rate-input/manifest.json"), "utf8"),
    );
    assert.equal(manifest.source, identity.source);
    assert.equal(manifest.policy, readNativeRatePolicyHash());
    assert.equal(
      manifest.runtimeSHA256,
      createHash("sha256").update(readFileSync(bundle)).digest("hex"),
    );
    assert.equal(JSON.stringify(manifest).includes("fake-private-value"), false);
    assert.equal(
      readNativeRateInput(join(folder, "native-rate-input"), identity).runtimeSHA256,
      manifest.runtimeSHA256,
    );
    for (const changed of [
      { source: "b".repeat(40) },
      { portion: "integration" },
      { run: 13 },
      { repository: "example/other" },
    ])
      assert.throws(() =>
        readNativeRateInput(join(folder, "native-rate-input"), { ...identity, ...changed }),
      );
    const originalBundle = readFileSync(bundle);
    writeFileSync(bundle, Buffer.concat([originalBundle, Buffer.from("\n// tampered\n")]));
    assert.throws(() => readNativeRateInput(join(folder, "native-rate-input"), identity));
    writeFileSync(bundle, originalBundle);

    const execution = spawnSync(process.execPath, [bundle, "prepare", folder], {
      env: { PATH: process.env.PATH },
      encoding: "utf8",
    });
    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /Native admission/);
    assert.equal(execution.stdout, "");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("unreviewed source and malformed input identity cannot enter a blind native transport bundle", () => {
  const folder = mkdtempSync(join(tmpdir(), "native-rate-unexpected-"));
  try {
    const entry = join(folder, "unreviewed.mjs");
    const output = join(folder, "runtime.mjs");
    writeFileSync(entry, 'export const hidden = "unreviewed-example";\n');
    assert.throws(
      () => bundleNativeRateControls(output, { entryPoint: entry }),
      /outside its trusted controls/,
    );
    assert.equal(existsSync(output), false);
    for (const identity of [
      { source: "main", run: 12, repository: "example/repo", portion: "1" },
      { source: "a".repeat(40), run: 0, repository: "example/repo", portion: "1" },
      { source: "a".repeat(40), run: 12, repository: "example/repo", portion: "../hidden" },
    ])
      assert.throws(() => packageNativeRateControls(join(folder, "input.tgz"), identity));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
