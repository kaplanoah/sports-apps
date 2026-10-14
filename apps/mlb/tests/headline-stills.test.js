import test from "node:test";
import assert from "node:assert/strict";
import {
  STILL_MODEL,
  STILL_SCHEMA,
  STILLS_PER_READ,
  findHeadlineStills,
  hasHeadline,
} from "../worker/src/headline-stills.js";
import { createJobStorage } from "../../../tests/job-context.js";

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const STILL = "https://img.mlbstatic.com/mlb-images/image/upload/w_480,h_270/mlb/home-run.jpg";
const OTHER_STILL = "https://img.mlbstatic.com/mlb-images/image/upload/w_480,h_270/mlb/catch.jpg";
const NEW_STILL = "https://img.mlbstatic.com/mlb-images/image/upload/w_480,h_270/mlb/single.jpg";

/**
 * Claude, answering for each still with `answer(still)`: whether it has a headline, or how Claude
 * fails to say.
 * @param {(still: string) => boolean | "overloaded" | "refusal"} answer
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
    const headline = answer(body.messages[0].content[0].source.url);
    if (headline === "overloaded")
      return new Response(JSON.stringify({ error: { message: "Overloaded" } }), { status: 529 });
    if (headline === "refusal")
      return new Response(JSON.stringify({ content: [], stop_reason: "refusal", usage: {} }));
    const text = JSON.stringify({ headline });
    return new Response(
      JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: {} }),
    );
  };
  return { requests, fetchImpl: /** @type {any} */ (fetchImpl) };
}

function createContext({ apiKey = "key", fetchImpl = /** @type {any} */ (null) } = {}) {
  const storage = createJobStorage();
  return /** @type {any} */ ({
    stored: storage.stored,
    env: apiKey ? { ANTHROPIC_API_KEY: apiKey } : {},
    fetchImpl,
    storage,
  });
}

test("Claude Haiku looks at the still at its address and answers in the schema whether it has a headline", async () => {
  const claude = createClaude(() => true);

  assert.equal(
    await hasHeadline({ apiKey: "key", fetchImpl: claude.fetchImpl, still: STILL }),
    true,
  );
  assert.equal(claude.requests[0].model, STILL_MODEL);
  assert.equal(STILL_MODEL, "claude-haiku-5-5");
  assert.deepEqual(claude.requests[0].messages[0].content, [
    { type: "image", source: { type: "url", url: STILL } },
  ]);
  assert.deepEqual(claude.requests[0].output_config, {
    effort: "low",
    format: { type: "json_schema", schema: STILL_SCHEMA },
  });

  const clean = createClaude(() => false);
  assert.equal(
    await hasHeadline({ apiKey: "key", fetchImpl: clean.fetchImpl, still: STILL }),
    false,
  );
});

test("an answer Claude didn't finish is no answer", async () => {
  const claude = createClaude(() => "refusal");

  await assert.rejects(
    hasHeadline({ apiKey: "key", fetchImpl: claude.fetchImpl, still: STILL }),
    /Claude stopped without finishing: refusal/,
  );
});

test("each still goes to Claude once: a game read again asks only about a still that's new", async () => {
  const claude = createClaude((still) => still === STILL);
  const context = createContext({ fetchImpl: claude.fetchImpl });

  const first = await findHeadlineStills(context, "849826", [STILL, OTHER_STILL]);
  assert.deepEqual([...first.withHeadlines], [STILL]);
  assert.equal(first.isFinished, true);
  assert.equal(claude.requests.length, 2);

  const again = await findHeadlineStills(context, "849826", [STILL, OTHER_STILL]);
  assert.deepEqual([...again.withHeadlines], [STILL]);
  assert.equal(claude.requests.length, 2);

  await findHeadlineStills(context, "849826", [STILL, NEW_STILL]);
  assert.equal(claude.requests.length, 3);
  assert.deepEqual(context.stored.get("headline-stills:849826"), {
    [STILL]: true,
    [NEW_STILL]: false,
  });
});

test("when Claude doesn't answer for a still it was asked about, the read fails, keeping the answers it gave, and the next asks only about that still", async () => {
  const claude = { isDown: true };
  const fake = createClaude((still) => (still === STILL && claude.isDown ? "overloaded" : true));
  const context = createContext({ fetchImpl: fake.fetchImpl });

  await assert.rejects(
    findHeadlineStills(context, "849826", [STILL, OTHER_STILL]),
    /didn't answer for 1 of game 849826's stills/,
  );
  assert.deepEqual(context.stored.get("headline-stills:849826"), { [OTHER_STILL]: true });

  claude.isDown = false;
  const found = await findHeadlineStills(context, "849826", [STILL, OTHER_STILL]);
  assert.deepEqual([...found.withHeadlines], [STILL, OTHER_STILL]);
  assert.equal(fake.requests.length, 3);
});

test("a read asks Claude about only the first few stills it hasn't seen, and isn't finished until every still has an answer", async () => {
  const stills = Array.from({ length: 12 }, (_, index) => `${STILL}?play=${index}`);
  const claude = createClaude((still) => still.endsWith("play=7"));
  const context = createContext({ fetchImpl: claude.fetchImpl });
  assert.equal(STILLS_PER_READ, 5);

  const first = await findHeadlineStills(context, "849826", stills);
  assert.equal(first.isFinished, false);
  assert.deepEqual([...first.withHeadlines], []);
  assert.equal(claude.requests.length, 5);

  const second = await findHeadlineStills(context, "849826", stills);
  assert.equal(second.isFinished, false);
  assert.deepEqual([...second.withHeadlines], [stills[7]]);
  assert.equal(claude.requests.length, 10);

  const third = await findHeadlineStills(context, "849826", stills);
  assert.equal(third.isFinished, true);
  assert.deepEqual([...third.withHeadlines], [stills[7]]);
  assert.equal(claude.requests.length, 12);
  assert.equal(Object.keys(context.stored.get("headline-stills:849826")).length, 12);
});

test("without the Worker's API key, no still goes to Claude, each counts as clean, and none is kept", async () => {
  const claude = createClaude(() => true);
  const context = createContext({ apiKey: "", fetchImpl: claude.fetchImpl });

  const found = await findHeadlineStills(context, "849826", [STILL]);
  assert.deepEqual([...found.withHeadlines], []);
  assert.equal(found.isFinished, true);
  assert.equal(claude.requests.length, 0);
  assert.equal(context.stored.size, 0);
});
