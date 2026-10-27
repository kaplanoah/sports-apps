import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** @param {string} root */
export function createEvidenceCertificate(root) {
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:3072",
      "-sha256",
      "-days",
      "1",
      "-nodes",
      "-keyout",
      join(root, "key.pem"),
      "-out",
      join(root, "certificate.pem"),
      "-subj",
      "/CN=example-evidence",
    ],
    { stdio: "pipe" },
  );
  assert.equal(result.status, 0);
  return readFileSync(join(root, "certificate.pem"), "utf8");
}
