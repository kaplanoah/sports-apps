import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** @param {string | Buffer} content */
export const hashReviewContent = (content) => createHash("sha256").update(content).digest("hex");

/** @param {string} folder @param {string[]} paths */
export function describeSuppliedContent(folder, paths) {
  return [...new Set(paths)].sort().map((path) => {
    const content = readFileSync(join(folder, path));
    return { path, bytes: content.length, sha256: hashReviewContent(content) };
  });
}

/** @param {any} record @param {any} area @param {string} folder */
export function verifyCodexCoverage(record, area, folder) {
  const required = [...Object.values(area.partsByFile).flat(), ...area.rules];
  const expected = describeSuppliedContent(folder, required);
  const attempt = record.tries?.[0];
  if (
    record.area !== area.area ||
    record.tries?.length !== 1 ||
    attempt?.evidence?.kind !== "supplied-content" ||
    !/^[a-f0-9]{64}$/.test(attempt.evidence.promptSha256 ?? "") ||
    JSON.stringify(attempt.evidence.files) !== JSON.stringify(expected) ||
    Object.hasOwn(attempt, "reads")
  )
    throw new Error("Missing or changed Codex supplied-content coverage.");
  return { ...record, unread: [], isAnswered: attempt.answer !== null };
}
