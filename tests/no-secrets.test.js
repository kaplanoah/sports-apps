import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// The repo is public, so nothing in it may name a real Worker, a page's key, the Cloudflare
// account, or a token or key. Tests and docs use placeholders: `example` or `example-subdomain`
// for the account's workers.dev subdomain, `k3y` or `<key>` for a page's key, and a run of one
// character, as "7".repeat(32) writes, for an account id or a token.

const REPO_ROOT = `${import.meta.dirname}/..`;
const BINARY_FILES = /\.(?:png|woff2)$/;
const SUBDOMAIN_PLACEHOLDERS = new Set(["example", "example-subdomain", "<subdomain>"]);

/** @param {string} text */
const isOneCharacterRun = (text) => new Set(text).size === 1;

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
    name: "an account's real workers.dev subdomain",
    pattern: /(?<![\w.-])([a-z0-9-]+)\.workers\.dev\b/g,
    isPlaceholder: (match) => SUBDOMAIN_PLACEHOLDERS.has(match[1]),
  },
  {
    name: "a page's key in its address",
    pattern: /workers\.dev\/([A-Za-z0-9_-]{16,})/g,
  },
  {
    name: "a page's key",
    pattern: /\bAPP_KEY\b["']?\s*[=:]\s*["'`]?([A-Za-z0-9_-]{16,})/g,
    isPlaceholder: (match) => isOneCharacterRun(match[1]),
  },
  {
    name: "a Cloudflare account id",
    pattern: /accounts\/[0-9a-f]{32}\b/g,
  },
  {
    // An id inside an address or a file's name, as a feed's links hold, is the feed's own.
    name: "a Cloudflare account id",
    pattern: /(?<![\w/.-])([0-9a-f]{32})(?![\w/.-])/g,
    isPlaceholder: (match) => isOneCharacterRun(match[1]),
  },
  {
    name: "a Cloudflare API token",
    pattern: /\b(?:CLOUDFLARE_API_TOKEN\b["']?\s*[=:]\s*|Bearer\s+)["'`]?([A-Za-z0-9_-]{40})\b/g,
    isPlaceholder: (match) => isOneCharacterRun(match[1]),
  },
  {
    name: "a GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})\b/g,
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
 * Each secret a text holds, by what it is and the line it's on.
 * @param {string} text
 */
const scan = (text) =>
  SECRETS.flatMap(({ name, pattern, isPlaceholder }) =>
    [...text.matchAll(pattern)]
      .filter((match) => !isPlaceholder?.(match))
      .map((match) => ({ name, line: text.slice(0, match.index).split("\n").length })),
  );

/** @param {string} text */
const nameSecrets = (text) => scan(text).map(({ name }) => name);

/**
 * Each secret a file holds, as "<path>:<line> <name>".
 * @param {string} path
 */
const listSecretsIn = (path) =>
  scan(readFileSync(`${REPO_ROOT}/${path}`, "utf8")).map(
    ({ name, line }) => `${path}:${line} ${name}`,
  );

test("no tracked file names a real Worker, a page's key, the Cloudflare account, or an API key", () => {
  const found = listTrackedFiles().flatMap(listSecretsIn);
  assert.deepEqual(found, []);
});

test("the scan knows a real address from a placeholder", () => {
  assert.deepEqual(
    nameSecrets("https://wnba-app.example-subdomain.workers.dev/k3y/ and <key>"),
    [],
  );
  assert.deepEqual(nameSecrets("https://mlb-app.example.workers.dev/k3y/"), []);
  const realSubdomain = ["wnba-app", "someone", "workers", "dev"].join(".");
  assert.deepEqual(nameSecrets(`https://${realSubdomain}/k3y/`), ["a Worker's real subdomain"]);
  assert.deepEqual(nameSecrets(`workers.dev/${"a1B2".repeat(8)}/`), [
    "a page's key in its address",
  ]);
  assert.deepEqual(nameSecrets(`accounts/${"7".repeat(32)}/workers`), ["a Cloudflare account id"]);
  assert.deepEqual(nameSecrets(["sk", "ant", "api03", "a".repeat(20)].join("-")), [
    "an Anthropic API key",
  ]);
});

test("the scan finds an account's own subdomain, a key, an id, and a token wherever they stand", () => {
  const accountSubdomain = ["someone", "workers", "dev"].join(".");
  assert.deepEqual(nameSecrets(`https://${accountSubdomain}/`), [
    "an account's real workers.dev subdomain",
  ]);
  assert.deepEqual(nameSecrets("the example.workers.dev subdomain"), []);
  const key = "a1B2".repeat(8);
  assert.deepEqual(nameSecrets(`APP_KEY=${key}`), ["a page's key"]);
  assert.deepEqual(nameSecrets(`{ "APP_KEY": "${key}" }`), ["a page's key"]);
  assert.deepEqual(scan(`[vars]\nAPP_KEY=${key}`), [{ name: "a page's key", line: 2 }]);
  assert.deepEqual(nameSecrets(`APP_KEY=${"k".repeat(32)} APP_KEY=k3y`), []);
  const accountId = "0123456789abcdef".repeat(2);
  assert.deepEqual(nameSecrets(`CLOUDFLARE_ACCOUNT_ID=${accountId}`), ["a Cloudflare account id"]);
  assert.deepEqual(
    nameSecrets(`"${"7".repeat(32)}" and /feed/${accountId}.mp3 and ${accountId}-x`),
    [],
  );
  const token = "Ab3_".repeat(10);
  assert.deepEqual(nameSecrets(`CLOUDFLARE_API_TOKEN=${token}`), ["a Cloudflare API token"]);
  assert.deepEqual(nameSecrets(`authorization: Bearer ${token}`), ["a Cloudflare API token"]);
  assert.deepEqual(nameSecrets(`Bearer ${"t".repeat(40)} and Bearer t0k`), []);
  assert.deepEqual(nameSecrets(["ghp", "A1b2".repeat(9)].join("_")), ["a GitHub token"]);
  assert.deepEqual(nameSecrets(["github", "pat", "11ABCDEFG0123456789abc", "xyz"].join("_")), [
    "a GitHub token",
  ]);
});
