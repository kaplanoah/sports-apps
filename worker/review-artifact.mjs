import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_ARCHIVE_BYTES = 1024 * 1024;
const READ_ARCHIVE = String.raw`
import json, stat, sys, zipfile
allowed = set(json.loads(sys.argv[2]))
with zipfile.ZipFile(sys.argv[1]) as archive:
    entries = archive.infolist()
    if len(entries) != len(allowed) or {entry.filename for entry in entries} != allowed:
        raise ValueError("Unexpected or duplicate artifact members")
    result = {}
    for entry in entries:
        kind = stat.S_IFMT(entry.external_attr >> 16)
        if kind not in (0, stat.S_IFREG) or entry.flag_bits & 1 or entry.file_size > 65536:
            raise ValueError("Unsafe or oversized artifact member")
        result[entry.filename] = archive.read(entry).decode("utf-8")
    print(json.dumps(result))
`;

/** @param {Response} response */
async function readBoundedArchive(response) {
  if (!response.ok || !response.body) throw new Error("Review artifact download failed.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ARCHIVE_BYTES) throw new Error("Review artifact archive is too large.");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

/**
 * @param {any} artifact
 * @param {{ repository: string, repositoryId: number, run: number, token: string, names: string[], digest?: string, fetchImpl?: typeof fetch }} options
 */
export async function readReviewArtifact(artifact, options) {
  if (
    !Number.isSafeInteger(artifact?.id) ||
    artifact.workflow_run?.id !== options.run ||
    !Number.isSafeInteger(options.repositoryId) ||
    artifact.workflow_run?.repository_id !== options.repositoryId ||
    artifact.expired ||
    artifact.size_in_bytes > MAX_ARCHIVE_BYTES ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "") ||
    (options.digest && artifact.digest !== `sha256:${options.digest}`)
  )
    throw new Error("Invalid review artifact provenance.");
  const response = await (options.fetchImpl ?? fetch)(
    `https://api.github.com/repos/${options.repository}/actions/artifacts/${artifact.id}/zip`,
    {
      headers: {
        authorization: `Bearer ${options.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10000),
    },
  );
  const archive = await readBoundedArchive(response);
  if (`sha256:${createHash("sha256").update(archive).digest("hex")}` !== artifact.digest)
    throw new Error("Review artifact archive digest mismatch.");
  const folder = mkdtempSync(join(tmpdir(), "review-publication-"));
  try {
    const archivePath = join(folder, "artifact.zip");
    writeFileSync(archivePath, archive);
    const files = JSON.parse(
      execFileSync(
        "python3",
        ["-I", "-c", READ_ARCHIVE, archivePath, JSON.stringify(options.names)],
        {
          encoding: "utf8",
          env: { PATH: process.env.PATH },
          maxBuffer: 256 * 1024,
          timeout: 5000,
        },
      ),
    );
    rmSync(archivePath);
    for (const name of options.names) {
      if (!/^[a-z-]+\.json$/.test(name)) throw new Error("Invalid artifact data filename.");
      writeFileSync(join(folder, name), files[name]);
    }
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
  return folder;
}
