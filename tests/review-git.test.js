import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRefusal } from "../worker/review-git.mjs";
import { readRepoFile } from "./repo-files.js";

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
  ["grep", "-Otouch output", "-e", "text"],
  ["grep", "--open-files-in-pager", "-e", "text"],
  ["grep", "--open-files-in-pager=touch output", "-e", "text"],
  ["grep", "--no-index", "-e", "text", "--", "/etc/hostname"],
  ["grep", "--untracked", "-e", "text"],
  ["grep", "--recurse-submodules", "-e", "text"],
  ["grep", "--textconv", "-e", "text"],
  ["grep", "--cached", "-e", "text"],
  ["grep", "-f", "/etc/hostname"],
  ["grep", "-e", "text", "HEAD"],
  ["grep", "-e", "text", "--", "/etc/hostname"],
  ["grep", "-e", "text", "--", "../outside"],
  ["grep", "-e", "text", "--", "nested/../../outside"],
  ["grep", "text"],
  ["grep", "-e"],
  ["grep", "-n", "--", "README.md"],
  ["grep"],
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
  ["grep", "-n", "-F", "-e", "text", "--", "README.md"],
  ["grep", "-l", "-i", "-w", "-E", "-e", "text.*", "--", "worker"],
  ["grep", "-n", "-e", "first", "-e", "second", "--", "."],
  ["grep", "-e", "--no-index"],
  ["grep", "-e", "--open-files-in-pager=touch output"],
  ["grep", "-e", ""],
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

test("allows each form of git grep, git log, and git show the review prompts name", () => {
  for (const args of ALLOWED) assert.equal(findRefusal(args, ROOT), null, args.join(" "));
});

test("search flags find tracked checkout text, never untracked files or a symlink's target", () => {
  const directory = mkdtempSync(join(tmpdir(), "review-search-"));
  const checkout = join(directory, "repo");
  mkdirSync(join(checkout, "worker"), { recursive: true });
  const script = join(checkout, "worker", "review-git.mjs");
  writeFileSync(script, readRepoFile("worker/review-git.mjs"));
  writeFileSync(join(checkout, "tracked.txt"), "SearchExample first\nSearchExample second\n");
  writeFileSync(join(checkout, "untracked.txt"), "SearchExample hidden\n");
  const outside = join(directory, "outside.txt");
  writeFileSync(outside, "SearchExample outside\n");
  symlinkSync(outside, join(checkout, "outside-link.txt"));
  execFileSync("git", ["init", "--quiet", checkout]);
  execFileSync("git", ["-C", checkout, "add", "--", "tracked.txt", "outside-link.txt"]);
  const lines = execFileSync(
    process.execPath,
    [script, "grep", "-n", "-F", "-e", "SearchExample"],
    {
      encoding: "utf8",
    },
  );
  assert.equal(lines, "tracked.txt:1:SearchExample first\ntracked.txt:2:SearchExample second\n");
  const files = execFileSync(
    process.execPath,
    [script, "grep", "-l", "-i", "-w", "-E", "-e", "searchexample (first|second)", "--", "."],
    { encoding: "utf8" },
  );
  assert.equal(files, "tracked.txt\n");
  const patterns = execFileSync(
    process.execPath,
    [script, "grep", "-n", "-F", "-e", "first", "-e", "second", "--", "tracked.txt"],
    { encoding: "utf8" },
  );
  assert.equal(patterns, lines);
  const missing = spawnSync(process.execPath, [script, "grep", "-F", "-e", "--no-index"], {
    encoding: "utf8",
  });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr, "");
});

test("search refuses pager commands and outside paths before invoking git", () => {
  const directory = mkdtempSync(join(tmpdir(), "review-search-refusal-"));
  const invoked = join(directory, "invoked");
  const output = join(directory, "pager-output");
  writeFileSync(
    join(directory, "git"),
    `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(invoked)}, "called");\n`,
    { mode: 0o755 },
  );
  const script = fileURLToPath(new URL("../worker/review-git.mjs", import.meta.url));
  for (const args of [
    [`-Otouch ${output}`, "-e", "text"],
    [`--open-files-in-pager=touch ${output}`, "-e", "text"],
    ["--no-index", "-e", "text", "--", "../outside"],
    ["-e", "text", "--", "../outside"],
    ["-e", "text", "--", "/etc/hostname"],
  ]) {
    const result = spawnSync(process.execPath, [script, "grep", ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: directory },
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /review-git: refused:/);
    assert.equal(existsSync(invoked), false);
    assert.equal(existsSync(output), false);
  }
});

test("runs git with no shell, and refuses before git runs", () => {
  const script = fileURLToPath(new URL("../worker/review-git.mjs", import.meta.url));
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
