import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRefusal } from "../worker/review-git.mjs";
import { REPO_ROOT } from "./repo-files.js";

const ROOT = "/repo";

// Each spelling a shell turns into --output= before the script sees it, as `--out''put=x`,
// `--out"put"=x`, and `--out\put=x` all arrive.
const REFUSED = [
  ["show", "HEAD", "--output=x"],
  ["log", "--output", "x"],
  ["show", "--output=/tmp/x", "HEAD"],
  ["show", "--no-index", "/etc/hostname", "README.md"],
  ["log", "-c", "core.pager=touch x"],
  ["log", "--exec-path=/tmp"],
  ["show", "--ext-diff", "HEAD"],
  ["show", "--textconv", "HEAD:README.md"],
  ["log", "-O/etc/hostname", "-p"],
  ["log", "-p", "--", "/etc/hostname"],
  ["log", "-p", "--", "../outside"],
  ["log", "/etc/hostname"],
  ["log", "-L1,1:/etc/hostname"],
  ["log", "-L", "1,1:../outside"],
  ["log", "-L", ":main:/etc/hostname"],
  ["log", "-Lnot-a-range"],
  ["log", "-L"],
  ["show", "HEAD^1:../outside"],
  ["log", "-n", "x"],
  ["log", "-n"],
  ["blame", "--contents", "/etc/hostname", "--", "README.md"],
  ["diff", "--no-index", "/etc/hostname", "/dev/null"],
  [],
];

const ALLOWED = [
  ["log", "-p", "--", "worker/plan-review.mjs"],
  ["log", "-L10,20:worker/plan-review.mjs"],
  ["log", "-L", "10,+5:worker/plan-review.mjs"],
  ["log", "-L:renderIndex:worker/plan-review.mjs", "-1"],
  ["log", "-n", "3", "--oneline", "--", "README.md"],
  ["log", "-n3", "--format=%h %s"],
  ["log", "-5", "--pretty=format:%H", "--stat", "--follow", "--", "README.md"],
  ["log", "--name-only", "--name-status", "HEAD~3..HEAD"],
  ["show", "HEAD^1:README.md"],
  ["show", "HEAD^1:"],
  ["show", "--diff-merges=first-parent", "HEAD", "--", "worker/plan-review.mjs"],
  ["show", "--no-patch", "--format=%B", "origin/main"],
  ["show", "--stat", "HEAD", "--", "."],
];

test("refuses any option the review doesn't use, and any path outside the repo", () => {
  for (const args of REFUSED) assert.notEqual(findRefusal(args, ROOT), null, args.join(" "));
});

test("never repeats a refused argument back", () => {
  for (const args of REFUSED) {
    const refusal = findRefusal(args, ROOT) ?? "";
    const echoed = args
      .slice(1)
      .filter((argument) => argument.length > 2 && refusal.includes(argument));
    assert.deepEqual(echoed, [], args.join(" "));
  }
});

test("allows each form of git log and git show the review prompts name", () => {
  for (const args of ALLOWED) assert.equal(findRefusal(args, ROOT), null, args.join(" "));
});

test("runs git with no shell, and refuses before git runs", () => {
  const script = fileURLToPath(new URL("worker/review-git.mjs", REPO_ROOT));
  const subject = execFileSync("node", [script, "log", "-1", "--format=%s;$(false)"], {
    encoding: "utf8",
  });
  assert.match(subject, /;\$\(false\)\n$/);
  const output = join(mkdtempSync(join(tmpdir(), "review-git-")), "out");
  assert.throws(
    () => execFileSync("node", [script, "show", `--output=${output}`, "HEAD"], { stdio: "pipe" }),
    (/** @type {any} */ error) =>
      error.status === 2 && /refused: an option isn't one the review uses/.test(error.stderr),
  );
  assert.equal(existsSync(output), false);
});
