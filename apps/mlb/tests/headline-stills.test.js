import test from "node:test";
import assert from "node:assert/strict";
import {
  STILL_MODEL,
  STILL_SCHEMA,
  MAX_STILL_TRIES,
  STILLS_PER_READ,
  findHeadlineStills,
  forgetOtherSeasonsStills,
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
 * @param {(still: string) => boolean | "overloaded" | "refusal" | "unauthorized"} answer
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
    if (headline === "unauthorized")
      return new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), {
        status: 401,
      });
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
    failures: [],
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

test("a still Claude doesn't answer for counts as clean for now, keeping the answers it gave, and the next read asks only about that still", async () => {
  const claude = { isDown: true };
  const fake = createClaude((still) => (still === STILL && claude.isDown ? "overloaded" : true));
  const context = createContext({ fetchImpl: fake.fetchImpl });

  const missed = await findHeadlineStills(context, "849826", [STILL, OTHER_STILL]);
  assert.deepEqual([...missed.withHeadlines], [OTHER_STILL]);
  assert.equal(missed.isFinished, true);
  assert.deepEqual(context.stored.get("headline-stills:849826"), { [OTHER_STILL]: true });

  claude.isDown = false;
  const found = await findHeadlineStills(context, "849826", [STILL, OTHER_STILL]);
  assert.deepEqual([...found.withHeadlines], [STILL, OTHER_STILL]);
  assert.equal(fake.requests.length, 3);
  assert.equal(context.stored.has("headline-still-misses:849826"), false);
});

test("a still Claude doesn't answer for is named in the run's failures", async (t) => {
  t.mock.method(console, "error", () => {});
  const fake = createClaude((still) => (still === STILL ? "overloaded" : false));
  const context = createContext({ fetchImpl: fake.fetchImpl });

  await findHeadlineStills(context, "849826", [STILL, OTHER_STILL]);

  assert.deepEqual(context.failures, [
    "Asking Claude about 1 of game 849826's stills failed: Claude answered 529: Overloaded",
  ]);
});

test("a key Claude turns away never clears a still, and the read is tried again later", async (t) => {
  t.mock.method(console, "error", () => {});
  const claude = { isKeyRefused: true };
  const fake = createClaude((still) => (claude.isKeyRefused ? "unauthorized" : still === STILL));
  const context = createContext({ fetchImpl: fake.fetchImpl });

  for (let read = 0; read < MAX_STILL_TRIES + 2; read += 1) {
    const refused = await findHeadlineStills(context, "849826", [STILL, OTHER_STILL]);
    assert.deepEqual([refused.isFinished, refused.hasMisses], [true, true]);
  }
  assert.equal(context.stored.has("headline-stills:849826"), false);
  assert.match(
    context.failures[0],
    /^Asking Claude about 2 of game 849826's stills failed: Claude answered 401/,
  );

  claude.isKeyRefused = false;
  const found = await findHeadlineStills(context, "849826", [STILL, OTHER_STILL]);
  assert.deepEqual([...found.withHeadlines], [STILL]);
});

test("a still Claude never answers for is asked about a few reads, then counts as clean and is never asked about again", async () => {
  const fake = createClaude((still) => (still === STILL ? "overloaded" : false));
  const context = createContext({ fetchImpl: fake.fetchImpl });

  for (let read = 0; read < MAX_STILL_TRIES + 2; read += 1)
    await findHeadlineStills(context, "849826", [STILL, OTHER_STILL]);

  const askedAbout = fake.requests.filter(
    (request) => request.messages[0].content[0].source.url === STILL,
  );
  assert.equal(askedAbout.length, MAX_STILL_TRIES);
  assert.deepEqual(context.stored.get("headline-stills:849826"), {
    [STILL]: false,
    [OTHER_STILL]: false,
  });
  assert.equal(context.stored.has("headline-still-misses:849826"), false);
});

test("a read isn't finished until each still Claude missed has been asked about as often as the rest", async () => {
  const stills = Array.from({ length: 7 }, (_, index) => `${STILL}?play=${index}`);
  const fake = createClaude(() => "overloaded");
  const context = createContext({ fetchImpl: fake.fetchImpl });

  const first = await findHeadlineStills(context, "849826", stills);
  const second = await findHeadlineStills(context, "849826", stills);
  const third = await findHeadlineStills(context, "849826", stills);

  assert.deepEqual([first.isFinished, second.isFinished, third.isFinished], [false, true, false]);
  const asked = fake.requests.map((request) => request.messages[0].content[0].source.url);
  assert.deepEqual(asked.slice(0, 7).toSorted(), stills.toSorted());
});

test("once Claude answers again after a round it missed, a read isn't finished until the round's every still is asked about", async () => {
  const stills = Array.from({ length: 30 }, (_, index) => `${STILL}?play=${index}`);
  const claude = { isDown: true };
  const fake = createClaude(() => (claude.isDown ? "overloaded" : false));
  const context = createContext({ fetchImpl: fake.fetchImpl });
  for (let read = 0; read < stills.length / STILLS_PER_READ; read += 1)
    await findHeadlineStills(context, "849826", stills);
  assert.equal(Object.keys(context.stored.get("headline-still-misses:849826")).length, 30);

  claude.isDown = false;
  const reads = [];
  for (let read = 0; read < stills.length / STILLS_PER_READ; read += 1)
    reads.push((await findHeadlineStills(context, "849826", stills)).isFinished);

  assert.deepEqual(reads, [false, false, false, false, false, true]);
  assert.equal(Object.keys(context.stored.get("headline-stills:849826")).length, 30);
});

test("the answers for any game but the current season's finals are forgotten once the season changes", async () => {
  const claude = createClaude(() => true);
  const context = createContext({ fetchImpl: claude.fetchImpl });
  await findHeadlineStills(context, "776001", [STILL]);
  await findHeadlineStills(context, "849826", [STILL]);

  await forgetOtherSeasonsStills(context, { season: 2026, games: [{ id: "849826" }] });
  assert.deepEqual(
    [...context.stored.keys()].filter((key) => key.startsWith("headline-stills:")),
    ["headline-stills:849826"],
  );

  await findHeadlineStills(context, "776001", [STILL]);
  await forgetOtherSeasonsStills(context, { season: 2026, games: [{ id: "849826" }] });
  assert.ok(context.stored.has("headline-stills:776001"));

  await forgetOtherSeasonsStills(context, { season: 2027, games: [] });
  assert.deepEqual(
    [...context.stored.keys()].filter((key) => key.startsWith("headline-stills:")),
    [],
  );
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
