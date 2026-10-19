import test from "node:test";
import assert from "node:assert/strict";
import {
  listOffDiffFindings,
  readConversation,
  readThreads,
  renderContext,
} from "../worker/review-context.mjs";
import { LIST_HEADING } from "../worker/post-review.mjs";
import { OFF_DIFF_HEADING } from "../worker/review-state.mjs";

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
  /** @type {string[]} */
  const queries = [];
  const pages = [
    { nodes: [thread({})], pageInfo: { hasNextPage: true, endCursor: "one" } },
    { nodes: [thread({ line: 30 })], pageInfo: { hasNextPage: false, endCursor: "two" } },
  ];
  const callGraphQL = async (/** @type {string} */ query, /** @type {any} */ variables) => {
    queries.push(query);
    afters.push(variables.after);
    return { repository: { pullRequest: { reviewThreads: pages[afters.length - 1] } } };
  };
  const threads = await readThreads(callGraphQL, { owner: "o", name: "n", number: 7 });
  assert.deepEqual(afters, [null, "one"]);
  assert.match(queries[0], /comments\(last: \d+\)/, "a long thread keeps its newest replies");
  assert.deepEqual(
    threads.map((each) => each.line),
    [12, 30],
  );
});

test("a thread past the comments read keeps its first, which holds what it raised, and a short one holds each once", async () => {
  const comment = (/** @type {string} */ body) => ({ author: { login: "kaplanoah" }, body });
  const root = comment("the checklist");
  const last = Array.from({ length: 49 }, (_, index) => comment(`reply ${index + 12}`));
  const short = [root, comment("reply 1")];
  /** @type {string[]} */
  const queries = [];
  const callGraphQL = async (/** @type {string} */ query) => {
    queries.push(query);
    const nodes = [
      { ...thread({}), first: { nodes: [root] }, comments: { totalCount: 60, nodes: last } },
      { ...thread({}), first: { nodes: [root] }, comments: { totalCount: 2, nodes: short } },
    ];
    return {
      repository: {
        pullRequest: {
          reviewThreads: { nodes, pageInfo: { hasNextPage: false, endCursor: null } },
        },
      },
    };
  };
  const [long, brief] = await readThreads(callGraphQL, { owner: "o", name: "n", number: 7 });
  assert.match(queries[0], /first: comments\(first: 1\)/);
  assert.deepEqual(long.comments.nodes, [root, ...last]);
  assert.deepEqual(brief.comments.nodes, short);
  assert.ok(!("first" in long));
});

test("the context names each thread's place and state, with every reply, under the description", () => {
  const page = renderContext({
    title: "fix: Hold the sheet's title",
    description: "Holds every sheet's title in one spot.",
    threads: [thread({}), thread({ isResolved: true, isOutdated: true, line: null })],
    offDiff: [{ body: `${OFF_DIFF_HEADING}\n\n- \`a.js:3\`: **Nit** elsewhere` }],
  });
  assert.match(page, /^# fix: Hold the sheet's title\n\nHolds every sheet's title in one spot\./);
  assert.match(page, /# Review threads \(2\)/);
  assert.match(page, /## shared\/page\/sheet\.js:12 \(open\)/);
  assert.match(page, /## shared\/page\/sheet\.js:10 \(resolved, outdated\)/);
  assert.match(page, /\*\*kaplanoah:\*\*\n\nStays: the file moves back in the next PR\./);
  assert.match(
    page,
    /# Findings posted on files the pull request doesn't change\n\nFindings on files this pull request doesn't change:\n\n- `a\.js:3`: \*\*Nit\*\* elsewhere/,
  );
});

test("a thread that lists a review's Nits shows each of its items, so a later review raises none again", () => {
  const checklist = [
    LIST_HEADING,
    "",
    "- [ ] `a.js:3`: **Nit** one <!-- claude-finding 0000000000000000 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->",
    "- [ ] `b.js`: **Pre-existing** two <!-- claude-finding 1111111111111111 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->",
  ].join("\n");
  const page = renderContext({
    title: "fix: x",
    description: "",
    threads: [
      thread({
        path: "a.js",
        line: null,
        originalLine: null,
        comments: { nodes: [{ author: { login: "github-actions" }, body: checklist }] },
      }),
    ],
    offDiff: [],
  });
  assert.ok(page.includes(`## a.js:file (open)\n\n**github-actions:**\n\n${checklist}\n`));
});

test("a pull request with no description or threads says so", () => {
  const page = renderContext({ title: "ci: x", description: "", threads: [], offDiff: [] });
  assert.match(page, /\(No description\.\)/);
  assert.match(page, /# Review threads \(0\)\n\nNone yet\./);
});

test("the findings off the pull request's files are the review's own comments that hold them", () => {
  const comments = [
    { id: 1, user: { login: "github-actions[bot]" }, body: `${OFF_DIFF_HEADING}\n\n- a` },
    { id: 2, user: { login: "github-actions[bot]" }, body: "<!-- claude-review-summary -->" },
    { id: 3, user: { login: "someone" }, body: `${OFF_DIFF_HEADING}\n\n- b` },
  ];
  assert.deepEqual(
    listOffDiffFindings(comments).map((comment) => comment.id),
    [1],
  );
});

test("the conversation a review reads holds every thread and the review's findings off the files", async () => {
  const callGraphQL = async () => ({
    repository: {
      pullRequest: {
        reviewThreads: { nodes: [thread({})], pageInfo: { hasNextPage: false, endCursor: null } },
      },
    },
  });
  /** @type {string[]} */
  const paths = [];
  const callGitHub = async (/** @type {string} */ path) => {
    paths.push(path);
    return path.includes("page=1")
      ? [{ user: { login: "github-actions[bot]" }, body: `${OFF_DIFF_HEADING}\n\n- a` }]
      : [];
  };
  const { threads, offDiff } = await readConversation({
    callGraphQL,
    callGitHub,
    pullRequest: { owner: "o", name: "n", number: 7 },
  });
  assert.equal(threads.length, 1);
  assert.equal(offDiff.length, 1);
  assert.match(paths[0], /^\/issues\/7\/comments\?/);
});
