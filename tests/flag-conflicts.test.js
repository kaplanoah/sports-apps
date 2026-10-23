import test from "node:test";
import assert from "node:assert/strict";
import { flagConflicts, nameConflictMarker } from "../worker/flag-conflicts.mjs";

const REPOSITORY = "owner/sports-apps";
const MAIN_COMMIT = "a".repeat(40);

/**
 * GitHub's API with these open pull requests, each answering its mergeable states in turn, and
 * these comments on each.
 * @param {{ number: number, head: string, mergeable: (boolean | null)[] }[]} pulls
 * @param {Record<number, string[]>} [comments]
 */
function createFakeGitHub(pulls, comments = {}) {
  const posted = [];
  const reads = new Map();
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    const { pathname } = new URL(String(url));
    if (pathname.endsWith("/pulls")) return Response.json(pulls.map(({ number }) => ({ number })));
    const pullNumber = Number(pathname.match(/\/pulls\/(\d+)$/)?.[1]);
    if (pullNumber) {
      const pull = pulls.find((each) => each.number === pullNumber);
      const read = reads.get(pullNumber) ?? 0;
      reads.set(pullNumber, read + 1);
      const mergeable = pull.mergeable[Math.min(read, pull.mergeable.length - 1)];
      return Response.json({ number: pullNumber, mergeable, head: { sha: pull.head } });
    }
    const commentsNumber = Number(pathname.match(/\/issues\/(\d+)\/comments$/)?.[1]);
    if (init?.method === "POST") {
      posted.push({ number: commentsNumber, body: JSON.parse(String(init.body)).body });
      return Response.json({});
    }
    return Response.json((comments[commentsNumber] ?? []).map((body) => ({ body })));
  };
  return { fetchImpl, posted, reads };
}

const flag = (github, waits = []) =>
  flagConflicts({
    repository: REPOSITORY,
    mainCommit: MAIN_COMMIT,
    fetchImpl: github.fetchImpl,
    env: { GH_TOKEN: "token" },
    wait: async (ms) => {
      waits.push(ms);
    },
  });

test("a pull request a merge to main left in conflict gets a comment saying no CI runs until main is merged in", async () => {
  const waits = [];
  const github = createFakeGitHub([
    { number: 1, head: "b".repeat(40), mergeable: [false] },
    { number: 2, head: "c".repeat(40), mergeable: [true] },
  ]);

  assert.deepEqual(await flag(github, waits), [1]);
  assert.equal(github.reads.get(1), 1);
  assert.equal(github.reads.get(2), 1);
  assert.deepEqual(waits, []);

  assert.equal(github.posted.length, 1);
  assert.equal(github.posted[0].number, 1);
  assert.match(github.posted[0].body, /conflicts with `main` as of aaaaaaa, so GitHub runs no CI/);
  assert.ok(github.posted[0].body.includes(nameConflictMarker("b".repeat(40))));
});

test("a pull request already flagged at its head isn't flagged again, but one flagged at an earlier head is", async () => {
  const github = createFakeGitHub(
    [
      { number: 1, head: "b".repeat(40), mergeable: [false] },
      { number: 2, head: "c".repeat(40), mergeable: [false] },
    ],
    {
      1: [`Old note\n${nameConflictMarker("b".repeat(40))}`],
      2: [nameConflictMarker("d".repeat(40))],
    },
  );

  assert.deepEqual(await flag(github), [2]);
});

test("a pull request GitHub hasn't checked yet is asked again until it has", async () => {
  const waits = [];
  const github = createFakeGitHub([
    { number: 1, head: "b".repeat(40), mergeable: [null, null, false] },
  ]);

  assert.deepEqual(await flag(github, waits), [1]);

  assert.equal(github.reads.get(1), 3);
  assert.deepEqual(waits, [5000, 5000]);
});

test("a pull request GitHub never finishes checking is left alone after six asks", async () => {
  const github = createFakeGitHub([{ number: 1, head: "b".repeat(40), mergeable: [null] }]);

  assert.deepEqual(await flag(github), []);

  assert.equal(github.reads.get(1), 6);
  assert.equal(github.posted.length, 0);
});
