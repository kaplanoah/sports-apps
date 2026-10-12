import test from "node:test";
import assert from "node:assert/strict";
import { STILL_MODEL, findHeadlineStills, hasHeadline } from "../worker/src/headline-stills.js";

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const STILL = "https://img.mlbstatic.com/mlb-images/image/upload/w_480,h_270/mlb/home-run.jpg";
const OTHER_STILL = "https://img.mlbstatic.com/mlb-images/image/upload/w_480,h_270/mlb/catch.jpg";
const NEW_STILL = "https://img.mlbstatic.com/mlb-images/image/upload/w_480,h_270/mlb/single.jpg";

/**
 * Claude, answering for each still with `answer(still)`, a word or an error to throw.
 * @param {(still: string) => string} answer
 */
function createClaude(answer) {
  /** @type {any[]} */
  const requests = [];
  /**
   * @param {string} url
   * @param {any} init
   */
  const fetchImpl = async (url, init) => {
    assert.equal(url, CLAUDE_URL);
    const body = JSON.parse(init.body);
    requests.push(body);
    const text = answer(body.messages[0].content[0].source.url);
    if (text === "overloaded")
      return new Response(JSON.stringify({ error: { message: "Overloaded" } }), { status: 529 });
    return new Response(JSON.stringify({ content: [{ type: "text", text }], usage: {} }));
  };
  return { requests, fetchImpl: /** @type {any} */ (fetchImpl) };
}

function createContext({ apiKey = "key", fetchImpl = /** @type {any} */ (null) } = {}) {
  const stored = new Map();
  return /** @type {any} */ ({
    stored,
    env: apiKey ? { ANTHROPIC_API_KEY: apiKey } : {},
    fetchImpl,
    storage: {
      get: async (/** @type {string} */ key) => structuredClone(stored.get(key)),
      put: async (/** @type {string} */ key, /** @type {any} */ value) => {
        stored.set(key, structuredClone(value));
      },
    },
  });
}

test("Claude Haiku looks at the still at its address and answers yes or no", async () => {
  const claude = createClaude(() => "Yes.");

  assert.equal(
    await hasHeadline({ apiKey: "key", fetchImpl: claude.fetchImpl, still: STILL }),
    true,
  );
  assert.equal(claude.requests[0].model, STILL_MODEL);
  assert.equal(STILL_MODEL, "claude-haiku-5-5");
  assert.deepEqual(claude.requests[0].messages[0].content, [
    { type: "image", source: { type: "url", url: STILL } },
  ]);

  const clean = createClaude(() => "no");
  assert.equal(
    await hasHeadline({ apiKey: "key", fetchImpl: clean.fetchImpl, still: STILL }),
    false,
  );
});

test("an answer that is neither yes nor no is no answer", async () => {
  const claude = createClaude(() => "It shows a ballpark.");

  await assert.rejects(
    hasHeadline({ apiKey: "key", fetchImpl: claude.fetchImpl, still: STILL }),
    /neither yes nor no/,
  );
});

test("each still goes to Claude once: a game read again asks only about a still that's new", async () => {
  const claude = createClaude((still) => (still === STILL ? "yes" : "no"));
  const context = createContext({ fetchImpl: claude.fetchImpl });

  const first = await findHeadlineStills(context, "849826", [STILL, OTHER_STILL]);
  assert.deepEqual([...first], [STILL]);
  assert.equal(claude.requests.length, 2);

  const again = await findHeadlineStills(context, "849826", [STILL, OTHER_STILL]);
  assert.deepEqual([...again], [STILL]);
  assert.equal(claude.requests.length, 2);

  await findHeadlineStills(context, "849826", [STILL, NEW_STILL]);
  assert.equal(claude.requests.length, 3);
  assert.deepEqual(context.stored.get("headline-stills:849826"), {
    [STILL]: true,
    [NEW_STILL]: false,
  });
});

test("when Claude doesn't answer for a still, the read fails, keeping the answers it gave, and the next asks only about that still", async () => {
  const claude = { isDown: true };
  const fake = createClaude((still) => (still === STILL && claude.isDown ? "overloaded" : "yes"));
  const context = createContext({ fetchImpl: fake.fetchImpl });

  await assert.rejects(
    findHeadlineStills(context, "849826", [STILL, OTHER_STILL]),
    /didn't answer for 1 of game 849826's stills/,
  );
  assert.deepEqual(context.stored.get("headline-stills:849826"), { [OTHER_STILL]: true });

  claude.isDown = false;
  const found = await findHeadlineStills(context, "849826", [STILL, OTHER_STILL]);
  assert.deepEqual([...found], [STILL, OTHER_STILL]);
  assert.equal(fake.requests.length, 3);
});

test("without the Worker's API key, no still goes to Claude, each counts as clean, and none is kept", async () => {
  const claude = createClaude(() => "yes");
  const context = createContext({ apiKey: "", fetchImpl: claude.fetchImpl });

  assert.deepEqual([...(await findHeadlineStills(context, "849826", [STILL]))], []);
  assert.equal(claude.requests.length, 0);
  assert.equal(context.stored.size, 0);
});
