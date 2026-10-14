import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// The repo is public, so nothing in it may name a real Worker, a page's key, the Cloudflare
// account, or an API key. Tests and docs use placeholders: `example` or `example-subdomain` for
// the Worker's subdomain, `k3y` or `<key>` for a page's key.

const REPO_ROOT = `${import.meta.dirname}/..`;
const BINARY_FILES = /\.(?:png|woff2)$/;
const SUBDOMAIN_PLACEHOLDERS = new Set(["example", "example-subdomain", "<subdomain>"]);

/**
 * What each pattern finds, and whether a match is a placeholder.
 * @type {{ name: string, pattern: RegExp, isPlaceholder?: (match: RegExpExecArray) => boolean }[]}
 */
const SECRETS = [
  {
    name: "a Worker's real subdomain",
    pattern: /\b[a-z0-9-]+\.([a-z0-9-]+)\.workers\.dev\b/g,
    isPlaceholder: (match) => SUBDOMAIN_PLACEHOLDERS.has(match[1]),
  },
  {
    name: "a page's key in its address",
    pattern: /workers\.dev\/([A-Za-z0-9_-]{16,})/g,
  },
  {
    name: "a Cloudflare account id",
    pattern: /accounts\/[0-9a-f]{32}\b/g,
  },
  {
    name: "an Anthropic API key",
    pattern: /sk-ant-[A-Za-z0-9_-]{16,}/g,
  },
];

/** @returns {string[]} */
const listTrackedFiles = () =>
  execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((path) => path && !BINARY_FILES.test(path));

/**
 * Each secret a file holds, as "<path>:<line> <name>".
 * @param {string} path
 */
function listSecretsIn(path) {
  const text = readFileSync(`${REPO_ROOT}/${path}`, "utf8");
  const found = [];
  for (const { name, pattern, isPlaceholder } of SECRETS) {
    for (const match of text.matchAll(pattern)) {
      if (isPlaceholder?.(match)) continue;
      const line = text.slice(0, match.index).split("\n").length;
      found.push(`${path}:${line} ${name}`);
    }
  }
  return found;
}

test("no tracked file names a real Worker, a page's key, the Cloudflare account, or an API key", () => {
  const found = listTrackedFiles().flatMap(listSecretsIn);
  assert.deepEqual(found, []);
});

test("the scan knows a real address from a placeholder", () => {
  const scan = (text) =>
    SECRETS.flatMap(({ name, pattern, isPlaceholder }) =>
      [...text.matchAll(pattern)].filter((match) => !isPlaceholder?.(match)).map(() => name),
    );
  assert.deepEqual(scan("https://wnba-app.example-subdomain.workers.dev/k3y/ and <key>"), []);
  assert.deepEqual(scan("https://mlb-app.example.workers.dev/k3y/"), []);
  const realSubdomain = ["wnba-app", "someone", "workers", "dev"].join(".");
  assert.deepEqual(scan(`https://${realSubdomain}/k3y/`), ["a Worker's real subdomain"]);
  assert.deepEqual(scan(`workers.dev/${"a1B2".repeat(8)}/`), ["a page's key in its address"]);
  assert.deepEqual(scan(`accounts/${"7".repeat(32)}/workers`), ["a Cloudflare account id"]);
  assert.deepEqual(scan(["sk", "ant", "api03", "a".repeat(20)].join("-")), [
    "an Anthropic API key",
  ]);
});
