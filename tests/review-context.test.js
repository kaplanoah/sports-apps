import test from "node:test";
import assert from "node:assert/strict";
import { readThreads, renderContext } from "../worker/review-context.mjs";

const thread = (/** @type {object} */ fields) => ({
  isResolved: false,
  isOutdated: false,
  path: "shared/page/sheet.js",
  line: 12,
  originalLine: 10,
  comments: {
    nodes: [
      {
        author: { login: "github-actions" },
        body: "**Nit** The comment names a file that's gone.",
      },
      { author: { login: "kaplanoah" }, body: "Stays: the file moves back in the next PR." },
    ],
  },
  ...fields,
});

test("every thread is read, page after page, until GitHub says there are no more", async () => {
  /** @type {(string | null)[]} */
  const afters = [];
  const pages = [
    { nodes: [thread({})], pageInfo: { hasNextPage: true, endCursor: "one" } },
    { nodes: [thread({ line: 30 })], pageInfo: { hasNextPage: false, endCursor: "two" } },
  ];
  const callGraphQL = async (/** @type {string} */ _query, /** @type {any} */ variables) => {
    afters.push(variables.after);
    return { repository: { pullRequest: { reviewThreads: pages[afters.length - 1] } } };
  };
  const threads = await readThreads(callGraphQL, { owner: "o", name: "n", number: 7 });
  assert.deepEqual(afters, [null, "one"]);
  assert.deepEqual(
    threads.map((each) => each.line),
    [12, 30],
  );
});

test("the context names each thread's place and state, with every reply, under the description", () => {
  const page = renderContext({
    title: "fix: Hold the sheet's title",
    description: "Holds every sheet's title in one spot.",
    threads: [thread({}), thread({ isResolved: true, isOutdated: true, line: null })],
  });
  assert.match(page, /^# fix: Hold the sheet's title\n\nHolds every sheet's title in one spot\./);
  assert.match(page, /# Review threads \(2\)/);
  assert.match(page, /## shared\/page\/sheet\.js:12 \(open\)/);
  assert.match(page, /## shared\/page\/sheet\.js:10 \(resolved, outdated\)/);
  assert.match(page, /\*\*kaplanoah:\*\*\n\nStays: the file moves back in the next PR\./);
});

test("a pull request with no description or threads says so", () => {
  const page = renderContext({ title: "ci: x", description: "", threads: [] });
  assert.match(page, /\(No description\.\)/);
  assert.match(page, /# Review threads \(0\)\n\nNone yet\./);
});
