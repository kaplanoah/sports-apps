import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** @param {string} input @param {string} output @param {string} certificate */
export function encryptReviewTrialEvidence(input, output, certificate) {
  execFileSync(
    "openssl",
    [
      "cms",
      "-encrypt",
      "-aes-256-gcm",
      "-binary",
      "-outform",
      "DER",
      "-in",
      input,
      "-out",
      output,
      "-recip",
      certificate,
      "-keyopt",
      "rsa_padding_mode:oaep",
      "-keyopt",
      "rsa_oaep_md:sha256",
    ],
    { stdio: "pipe" },
  );
}

/** @param {string} root @param {string} text */
export function prepareTrialEvidenceCertificate(root, text) {
  if (text.includes("PRIVATE KEY"))
    throw new Error("Only a public evidence certificate is allowed.");
  const certificate = new X509Certificate(text);
  if (
    certificate.publicKey.asymmetricKeyType !== "rsa" ||
    certificate.publicKey.asymmetricKeyDetails.modulusLength < 3072
  )
    throw new Error("A strong RSA evidence certificate is required.");
  const path = join(root, "evidence-certificate.pem");
  writeFileSync(path, text);
  const input = join(root, "encryption-probe.txt");
  writeFileSync(input, "Non-secret encryption capability probe.");
  encryptReviewTrialEvidence(input, join(root, "encryption-probe.cms"), path);
  rmSync(input);
  rmSync(join(root, "encryption-probe.cms"));
  return certificate.fingerprint256;
}

/** @param {NodeJS.ProcessEnv} env @param {string} root */
export function retainPrivateTrialEvidence(env, root) {
  const raw = join(env.RUNNER_TEMP, "trial-raw");
  const destination = join(env.RUNNER_TEMP, "trial-private");
  mkdirSync(raw);
  mkdirSync(destination);
  cpSync(join(root, "data"), join(raw, "supplied"), { recursive: true });
  for (const name of ["identity.json", "configuration.json", "prompt.txt", "schema.json"])
    copyFileSync(join(root, name), join(raw, name));
  const transcript =
    env.TRIAL_PROVIDER === "codex"
      ? join(env.RUNNER_TEMP, "codex-events.jsonl")
      : env.EXECUTION_FILE;
  if (transcript && existsSync(transcript)) copyFileSync(transcript, join(raw, "transcript.json"));
  const answer = env.TRIAL_ANSWER_FILE ?? join(env.RUNNER_TEMP, "trial-answer.json");
  if (existsSync(answer)) copyFileSync(answer, join(raw, "answer.json"));
  if (env.TRIAL_PROVIDER === "claude" && env.STRUCTURED_OUTPUT)
    writeFileSync(join(raw, "answer.json"), env.STRUCTURED_OUTPUT);
  const archive = join(env.RUNNER_TEMP, "trial-raw.tgz");
  execFileSync("tar", ["-czf", archive, "-C", raw, "."]);
  encryptReviewTrialEvidence(
    archive,
    join(destination, "evidence.cms"),
    join(root, "evidence-certificate.pem"),
  );
}
