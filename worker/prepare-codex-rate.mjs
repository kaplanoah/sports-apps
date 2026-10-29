import { buildSync } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readNativeRatePolicyHash, createNativeAdmissionStepName } from "./codex-rate-policy.mjs";

import { listNativeRateControls } from "./codex-rate-source.mjs";

const controls = new Set(listNativeRateControls());

/** @param {string} destination @param {{entryPoint?:string}} [options] */
export function bundleNativeRateControls(
  destination,
  { entryPoint = fileURLToPath(new URL("./codex-rate-runtime.mjs", import.meta.url)) } = {},
) {
  const bundle = buildSync({
    absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
    entryPoints: [entryPoint],
    outfile: destination,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent",
    metafile: true,
  });
  if (
    Object.keys(bundle.metafile.inputs).some(
      (path) =>
        !controls.has(path) &&
        !/^(?:node_modules\/js-tiktoken\/|node_modules\/base64-js\/)/.test(path),
    )
  ) {
    rmSync(destination, { force: true });
    throw new Error("Native rate bundle includes code outside its trusted controls.");
  }
}

/** @param {string} destination @param {any} identity */
export function packageNativeRateControls(destination, identity) {
  createNativeAdmissionStepName(identity.portion);
  if (
    !/^[a-f0-9]{40}$/.test(identity.source ?? "") ||
    !Number.isSafeInteger(identity.run) ||
    identity.run <= 0 ||
    !/^[\w.-]+\/[\w.-]+$/.test(identity.repository ?? "")
  )
    throw new Error("Invalid native rate input identity.");
  mkdirSync(dirname(destination), { recursive: true });
  const folder = mkdtempSync(join(dirname(destination), "native-rate-package-"));
  const input = join(folder, "native-rate-input");
  mkdirSync(input);
  try {
    bundleNativeRateControls(join(input, "runtime.mjs"));
    writeFileSync(
      join(input, "manifest.json"),
      JSON.stringify({
        version: 1,
        source: identity.source,
        repository: identity.repository,
        run: identity.run,
        portion: identity.portion,
        policy: readNativeRatePolicyHash(),
        runtimeSHA256: createHash("sha256")
          .update(readFileSync(join(input, "runtime.mjs")))
          .digest("hex"),
      }),
    );
    execFileSync("tar", ["-czf", destination, "-C", folder, "native-rate-input"]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const env = process.env;
  const destination = join(env.RUNNER_TEMP, "native-rate-input.tgz");
  packageNativeRateControls(destination, {
    source: env.REVIEW_TRUSTED ?? env.GITHUB_SHA,
    run: Number(env.GITHUB_RUN_ID),
    repository: env.GITHUB_REPOSITORY,
    portion: env.PORTION ?? "proof",
  });
  appendFileSync(env.GITHUB_OUTPUT, `rate-input=${destination}\n`);
}
