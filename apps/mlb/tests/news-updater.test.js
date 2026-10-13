import test from "node:test";
import assert from "node:assert/strict";
import { NEWS_FEEDS } from "../worker/src/news-feeds.js";
import { LABEL_PROMPT } from "../worker/src/news-prompts.js";
import { createMlbNewsJob, readMlbRuleDrop } from "../worker/src/news-updater.js";
import { createFeedFetch } from "./news-fixtures.js";
import { createDocs, createJobStorage } from "../../../tests/job-context.js";

const NOW = Date.parse("2026-10-09T20:00:00Z");
const CLAUDE_URL = "https://api.anthropic.com/v1/messages";

const readStories = (content) => JSON.parse(content.slice(content.lastIndexOf("[")));

/**
 * The feeds as recorded, and a Claude that keeps every story, tagging each with the Mets and a code
 * that isn't a club's, and that keeps each request it gets in `calls`.
 */
function createFetch(calls) {
  const readFeed = createFeedFetch();
  return async (url, init) => {
    if (String(url) !== CLAUDE_URL) return readFeed(url);
    const body = JSON.parse(init.body);
    calls.push(body);
    const answers = readStories(body.messages[0].content).map((story) => ({
      id: story.id,
      keep: true,
      teams: ["NYM", "NYL"],
      reason: "News.",
    }));
    return Response.json({
      content: [{ type: "text", text: JSON.stringify({ stories: answers }) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
  };
}

async function runOnce() {
  const docs = createDocs();
  const calls = [];
  const readFeed = createFetch(calls);
  let requests = 0;
  await createMlbNewsJob().updateStore({
    docs,
    storage: createJobStorage(),
    loadSnapshot: async () => ({}),
    env: { ANTHROPIC_API_KEY: "test-key" },
    fetchImpl: async (url, init) => {
      requests += 1;
      return readFeed(url, init);
    },
    now: () => NOW,
  });
  return { docs, calls, requests };
}

test("a run reads each outlet once and asks Claude about only the stories the rules leave, by MLB's prompt", async () => {
  const { docs, calls, requests } = await runOnce();

  assert.equal(requests, NEWS_FEEDS.length + calls.length);
  assert.ok(calls.every((call) => call.system[0].text === LABEL_PROMPT));
  const asked = calls.flatMap((call) => readStories(call.messages[0].content));
  assert.ok(asked.length > 0);
  assert.ok(asked.every((story) => !readMlbRuleDrop(story)));
  assert.ok(!asked.some((story) => story.title.startsWith("Mets Morning News")));
  const { cards } = docs.stored.get("news/cards");
  assert.equal(cards.length, asked.length);
  assert.deepEqual(docs.stored.get("news/status").missing, ["dailynews-mets"]);
});

test("a story keeps only the codes of MLB's clubs that Claude tags it with", async () => {
  const { docs } = await runOnce();

  const { cards } = docs.stored.get("news/cards");
  assert.ok(cards.every((card) => card.lead.teams.join() === "NYM"));
});

test("MLB's prompt keeps the Mets' news, and another club's only when it matters across baseball", () => {
  assert.match(LABEL_PROMPT, /Its readers are New York Mets fans/);
  assert.match(LABEL_PROMPT, /the Yankees are another club/);
  assert.match(LABEL_PROMPT, /- other-club: news about one club other than the Mets/);
  assert.match(LABEL_PROMPT, /NYM \(Mets\), NYY \(Yankees\)/);
  assert.doesNotMatch(LABEL_PROMPT, /Examples of how the app's editor decided/);
});
