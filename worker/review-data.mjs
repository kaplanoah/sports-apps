// Validates review answers, coverage and sealed stage artifacts before trusted controls use them.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { isGitObjectId } from "./git-object.mjs";
import { findUnreadParts, gatherCandidates, readAnswer } from "./judge-review.mjs";
import { verifyCodexCoverage } from "./review-supplied.mjs";
import { isObject } from "./review-json.mjs";

/** @param {unknown} path */
export const isReviewPath = (path) =>
  typeof path === "string" &&
  path.length > 0 &&
  ![...path].some(
    (character) =>
      character === "\\" || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  ) &&
  path.split("/").every((part) => part !== "" && part !== "." && part !== "..");

/** @param {boolean} condition @param {string} message */
const requireData = (condition, message) => {
  if (!condition) throw new Error(`Invalid review data: ${message}.`);
};

/** @param {unknown} value */
const isText = (value) => typeof value === "string" && value.length > 0 && value.length <= 60000;

/** @param {any} answer @param {"candidates" | "findings"} key */
export function validateReviewAnswer(answer, key) {
  requireData(
    isObject(answer) && Array.isArray(answer.items) && Array.isArray(answer.unjudged),
    "answer shape",
  );
  for (const item of answer.unjudged)
    requireData(isObject(item) && isReviewPath(item.file) && isText(item.why), "unjudged file");
  for (const item of answer.items) {
    const fields =
      key === "candidates"
        ? ["path", "line", "weight", "confidence", "claim", "when", "fix"]
        : ["ids", "verdict", "weight", "path", "line", "body", "why"];
    requireData(
      isObject(item) && Object.keys(item).every((field) => fields.includes(field)),
      "unexpected finding field",
    );
    requireData(
      isObject(item) && isReviewPath(item.path) && Number.isSafeInteger(item.line) && item.line > 0,
      "finding location",
    );
    requireData(["Important", "Nit", "Pre-existing"].includes(item.weight), "finding weight");
    if (key === "candidates") {
      requireData(["high", "medium", "low"].includes(item.confidence), "candidate confidence");
      requireData([item.claim, item.when, item.fix].every(isText), "candidate text");
    } else {
      requireData(["confirmed", "rejected", "unsure"].includes(item.verdict), "finding verdict");
      requireData([item.body, item.why].every(isText), "finding text");
      requireData(
        Array.isArray(item.ids) &&
          item.ids.every((id) => typeof id === "string" && /^\d+\.\d+$/.test(id)),
        "finding ids",
      );
    }
  }
  return answer;
}

/** @param {string | undefined} text @param {"candidates" | "findings"} key
 * @param {{ checkout?: string, data?: string }} [roots]
 */
export function readReviewAnswer(text, key, roots = {}) {
  const parsed = JSON.parse(text ?? "null");
  requireData(
    isObject(parsed) && Array.isArray(parsed[key]) && Array.isArray(parsed.unjudged),
    "structured answer",
  );
  /** @param {unknown} path */
  const normalizePath = (path) => {
    if (typeof path !== "string") return path;
    if (isAbsolute(path)) {
      if (roots.data && isReviewPath(relative(roots.data, path)))
        return `.review/${relative(roots.data, path)}`;
      return roots.checkout ? relative(roots.checkout, path) : path;
    }
    return path.startsWith("./") ? path.slice(2) : path;
  };
  for (const item of parsed[key]) if (isObject(item)) item.path = normalizePath(item.path);
  for (const item of parsed.unjudged) if (isObject(item)) item.file = normalizePath(item.file);
  // Validate before readAnswer's normalization can discard malformed entries.
  validateReviewAnswer({ items: parsed[key], unjudged: parsed.unjudged }, key);
  return readAnswer(JSON.stringify(parsed), key);
}

/** @param {any} plan */
export function validateReviewPlan(plan) {
  requireData(
    isObject(plan) && ["first", "push", "none", "reviewed"].includes(plan.stage),
    "plan stage",
  );
  requireData(plan.since === null || isGitObjectId(plan.since), "reviewed revision");
  requireData(Array.isArray(plan.areas) && Array.isArray(plan.unread), "plan lists");
  for (const unread of plan.unread)
    requireData(isObject(unread) && isReviewPath(unread.path) && isText(unread.why), "unread file");
  const numbers = new Set();
  const parts = new Set();
  for (const area of plan.areas) {
    requireData(
      Number.isSafeInteger(area.area) && area.area > 0 && !numbers.has(area.area),
      "duplicate or invalid area",
    );
    numbers.add(area.area);
    requireData(
      isText(area.name) &&
        Array.isArray(area.files) &&
        Array.isArray(area.rules) &&
        isObject(area.partsByFile),
      "area shape",
    );
    requireData(area.files.every(isReviewPath) && area.rules.every(isReviewPath), "area paths");
    requireData(
      JSON.stringify(Object.keys(area.partsByFile).sort()) ===
        JSON.stringify([...area.files].sort()),
      "part file list",
    );
    for (const file of area.files) {
      const names = area.partsByFile[file];
      requireData(Array.isArray(names) && names.length > 0, "file parts");
      for (const name of names) {
        requireData(
          isReviewPath(name) && name.startsWith(`${plan.stage}/`) && !parts.has(name),
          "duplicate or unsafe part",
        );
        parts.add(name);
      }
    }
    requireData(
      area.rules.every((path) => path.startsWith("rules/") && path.endsWith(".md")),
      "rule paths",
    );
  }
  return plan;
}

/** @param {string} folder @returns {string[]} */
export function listReviewFiles(folder) {
  requireData(lstatSync(folder).isDirectory(), "artifact directory");
  return readdirSync(folder)
    .sort()
    .flatMap((name) => {
      requireData(isReviewPath(name), "artifact path");
      const path = join(folder, name);
      const stat = lstatSync(path);
      requireData(stat.isDirectory() || stat.isFile(), "artifact symlink or special file");
      if (!stat.isDirectory()) return [name];
      const children = listReviewFiles(path);
      requireData(children.length > 0, "empty artifact directory");
      return children.map((part) => `${name}/${part}`);
    })
    .sort();
}

/** @param {string} folder @param {string} name */
const hashReviewFile = (folder, name) =>
  createHash("sha256")
    .update(readFileSync(join(folder, name)))
    .digest("hex");

/** @param {NodeJS.ProcessEnv} env */
export function readReviewIdentity(env) {
  const identity = {
    repository: env.GITHUB_REPOSITORY,
    run: env.GITHUB_RUN_ID,
    head: env.REVIEW_HEAD,
    base: env.REVIEW_BASE,
    merge: env.REVIEW_MERGE,
    trusted: env.REVIEW_TRUSTED,
    workflow: env.GITHUB_WORKFLOW_REF,
    ...(env.REVIEW_PROVIDER
      ? { provider: env.REVIEW_PROVIDER, selection: env.REVIEW_SELECTION }
      : {}),
  };
  requireData(
    /^[\w.-]+\/[\w.-]+$/.test(identity.repository ?? "") && /^\d+$/.test(identity.run ?? ""),
    "run identity",
  );
  requireData(
    [identity.head, identity.base, identity.merge, identity.trusted].every((sha) =>
      isGitObjectId(sha),
    ),
    "revision identity",
  );
  requireData(
    identity.workflow === `${identity.repository}/.github/workflows/review.yml@refs/heads/main`,
    "workflow authority",
  );
  if (identity.provider !== undefined)
    requireData(
      ["claude", "codex"].includes(identity.provider) &&
        /^(initial|\d+)$/.test(identity.selection ?? ""),
      "provider identity",
    );
  return identity;
}

/** @param {string} folder @param {string} stage @param {object} identity @param {string[]} names */
export function sealReviewArtifact(folder, stage, identity, names) {
  requireData(
    new Set(names).size === names.length && names.every(isReviewPath),
    "artifact file list",
  );
  const files = Object.fromEntries(
    names.sort().map((name) => [name, hashReviewFile(folder, name)]),
  );
  writeFileSync(join(folder, "provenance.json"), JSON.stringify({ stage, identity, files }));
}

/** @param {string} folder @param {string} stage @param {object} identity @param {string[]} names */
export function validateReviewArtifact(folder, stage, identity, names) {
  const actual = listReviewFiles(folder);
  const metadata = JSON.parse(readFileSync(join(folder, "provenance.json"), "utf8"));
  requireData(
    isObject(metadata) && Object.keys(metadata).sort().join(",") === "files,identity,stage",
    "artifact metadata",
  );
  requireData(
    metadata.stage === stage && JSON.stringify(metadata.identity) === JSON.stringify(identity),
    "stale or foreign artifact",
  );
  requireData(isObject(metadata.files), "artifact manifest");
  const expected = [...names, "provenance.json"].sort();
  requireData(
    JSON.stringify(actual) === JSON.stringify(expected),
    "unexpected or missing artifact files",
  );
  requireData(
    JSON.stringify(Object.keys(metadata.files).sort()) === JSON.stringify([...names].sort()),
    "manifest files",
  );
  for (const name of names)
    requireData(metadata.files[name] === hashReviewFile(folder, name), "artifact content changed");
}

/** @param {any} plan */
export const listPlanFiles = (plan) => [
  "plan.json",
  "REVIEW.md",
  "AGENTS.md",
  "pull-request.md",
  ...(plan.provider ? ["test-context.md"] : []),
  ...(plan.areas.length
    ? [
        "stale-names.md",
        `${plan.stage}.md`,
        ...new Set(
          plan.areas.flatMap((area) => [...Object.values(area.partsByFile).flat(), ...area.rules]),
        ),
      ]
    : []),
];

/** @param {string} source @param {string} destination @param {string[]} names */
export function copyReviewFiles(source, destination, names) {
  for (const name of names) {
    requireData(isReviewPath(name), "copy path");
    const target = join(destination, name);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(source, name), target, 1);
  }
}

/** @param {any} record @param {any} area @param {string} folder */
export function recomputeReviewCoverage(record, area, folder) {
  if (record.provider === "codex") {
    const checked = verifyCodexCoverage(record, area, folder);
    if (checked.tries[0].answer !== null)
      validateReviewAnswer(checked.tries[0].answer, "candidates");
    return checked;
  }
  requireData(
    record.area === area.area &&
      Array.isArray(record.tries) &&
      record.tries.length > 0 &&
      record.tries.length <= 2,
    "reviewer record",
  );
  record = {
    ...record,
    tries: record.tries.map((attempt) => ({
      ...attempt,
      reads: Array.isArray(attempt.reads)
        ? attempt.reads.map(([path, ranges]) => [
            typeof path === "string" && isAbsolute(path) ? relative(folder, path) : path,
            ranges,
          ])
        : attempt.reads,
    })),
  };
  const parts = [...Object.values(area.partsByFile).flat(), ...area.rules];
  for (const attempt of record.tries) {
    requireData(Array.isArray(attempt.reads), "read records");
    if (attempt.answer !== null) validateReviewAnswer(attempt.answer, "candidates");
    for (const [path, ranges] of attempt.reads) {
      requireData(isReviewPath(path) && parts.includes(path) && Array.isArray(ranges), "read path");
      requireData(
        ranges.every(
          (range) =>
            Array.isArray(range) &&
            range.length === 2 &&
            range.every((number) => Number.isSafeInteger(number) && number > 0) &&
            range[1] >= range[0],
        ),
        "read range",
      );
    }
  }
  const reads = record.tries.map((attempt) =>
    attempt.reads.map(([path, ranges]) => [join(folder, path), ranges]),
  );
  return {
    ...record,
    unread: findUnreadParts(
      parts,
      reads,
      (part) => readFileSync(join(folder, part), "utf8"),
      folder,
    ),
    isAnswered: record.tries.at(-1).answer !== null,
  };
}

/** @param {any[]} records @param {any} across @param {any[]} candidates */
export function validateAcrossCandidates(records, across, candidates) {
  validateReviewAnswer(across, "findings");
  requireData(
    JSON.stringify(gatherCandidates(records)) === JSON.stringify(candidates),
    "candidate list changed",
  );
  const ids = across.items.flatMap((finding) => finding.ids);
  requireData(
    ids.length === candidates.length && candidates.every((candidate) => ids.includes(candidate.id)),
    "missing, duplicate or unknown candidate id",
  );
}
