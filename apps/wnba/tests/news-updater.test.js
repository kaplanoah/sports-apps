import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { LABELS_SCHEMA, NEWS_MODEL } from "../../../shared/worker/news-claude.js";
import { LABEL_PROMPT } from "../worker/src/news-prompts.js";
import { createWnbaNewsJob } from "../worker/src/news-updater.js";
import { createFeedFetch } from "./news-fixtures.js";
import { createDocs, createJobStorage } from "../../../tests/job-context.js";

const NOW = Date.parse("2026-10-05T16:00:00Z");
const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const ENV = { ANTHROPIC_API_KEY: "test-key" };

const readStories = (content) => JSON.parse(content.slice(content.lastIndexOf("[")));

/** @param {string} content */
const readCardsSoFar = (content) =>
  JSON.parse(content.slice(content.indexOf("["), content.indexOf("\n\nNew stories:")));

/**
 * Keeps every story but the ones `skip` names, which it drops as retold, and joins each to a card
 * as `place` says, from the story and the cards so far. It leaves out the ones `ignore` names.
 */
const answerLabels = (content, { skip, place, ignore }) =>
  readStories(content)
    .filter((story) => !ignore(story))
    .map((story) =>
      skip(story)
        ? { id: story.id, keep: false, why: "retold", reason: "Told already." }
        : {
            id: story.id,
            keep: true,
            teams: ["NYL", "XYZ"],
            reason: "News.",
            ...place(story, readCardsSoFar(content)),
          },
    );

/**
 * The feeds as recorded, and a Claude that answers as `skip`, `place`, and `ignore` say, or with
 * `status` when it's not 200, stopping for `stopReason`.
 */
function createFetch({
  skip = () => false,
  place = () => ({}),
  ignore = () => false,
  status = 200,
  stopReason = "end_turn",
  requests = [],
} = {}) {
  const readFeed = createFeedFetch();
  return async (url, init) => {
    if (String(url) !== CLAUDE_URL) return readFeed(url);
    const body = JSON.parse(init.body);
    requests.push({ headers: init.headers, body });
    if (status !== 200) return Response.json({ error: { message: "Overloaded" } }, { status });
    const answers = answerLabels(body.messages[0].content, { skip, place, ignore });
    return Response.json({
      content: [{ type: "text", text: JSON.stringify({ stories: answers }) }],
      stop_reason: stopReason,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900 },
    });
  };
}

/** @param {{ env?: Record<string, string>, now?: number }} [options] */
function createRun({ env = ENV, now = NOW } = {}) {
  const storage = createJobStorage();
  const docs = createDocs();
  const job = createWnbaNewsJob();
  const loadSnapshot = async () => ({});
  const runJob = (fetchImpl) =>
    job.updateStore({ docs, storage, loadSnapshot, env, fetchImpl, now: () => now });
  return { storage, docs, runJob };
}

const listStoryStates = (storage) =>
  [...storage.stored].filter(([key]) => key.startsWith("story:")).map(([, story]) => story.state);

/** @param {{ cards: any[] }} doc */
const listCardTitles = (doc) =>
  doc.cards.map(({ lead, more }) => [lead.title, ...more.map((story) => story.title)]);

test("a run has Claude judge every waiting story, twelve at a time, and saves a card for each it keeps, newest first", async () => {
  const requests = [];
  const { docs, runJob } = createRun();

  await runJob(createFetch({ requests }));

  assert.deepEqual(
    requests.map((request) => readStories(request.body.messages[0].content).length),
    [12, 12, 8],
  );
  assert.equal(requests[0].headers["x-api-key"], "test-key");
  assert.equal(requests[0].body.model, NEWS_MODEL);
  assert.deepEqual(requests[0].body.system[0].cache_control, { type: "ephemeral", ttl: "1h" });

  const { cards } = docs.stored.get("news/cards");
  assert.equal(cards.length, 32);
  const published = cards.map((card) => Date.parse(card.lead.publishedAt));
  assert.deepEqual(
    published,
    published.toSorted((first, second) => second - first),
  );
  const fields = Object.keys(cards[0].lead).filter((field) => field !== "teamFeed");
  assert.deepEqual(fields.sort(), [
    "author",
    "id",
    "outlet",
    "photo",
    "publishedAt",
    "source",
    "summary",
    "teams",
    "title",
    "url",
  ]);
  assert.deepEqual(cards[0].lead.teams, ["NYL"]);
  assert.deepEqual(cards[0].more, []);
});

test("Claude reads the cards so far, then the new stories numbered after them, in the order they came out", async () => {
  const requests = [];
  const { storage, runJob } = createRun();

  await runJob(createFetch({ requests }));

  const [first, second] = requests.map((request) => request.body.messages[0].content);
  assert.deepEqual(readCardsSoFar(first), []);
  assert.deepEqual(
    readCardsSoFar(second).map((card) => [card.id, card.title, card.more]),
    readStories(first).map((story, index) => [index + 1, story.title, []]),
  );
  assert.deepEqual(
    readStories(second).map((story) => story.id),
    Array.from({ length: 12 }, (_, index) => 13 + index),
  );
  const publishedAt = new Map(
    [...storage.stored.values()].map((story) => [story.title, Date.parse(story.publishedAt)]),
  );
  const asked = [first, second].flatMap((content) =>
    readStories(content).map((story) => publishedAt.get(story.title)),
  );
  assert.deepEqual(
    asked,
    asked.toSorted((earlier, later) => earlier - later),
  );
});

test("a story Claude drops as told already gets no card", async () => {
  const { docs, runJob } = createRun();
  const skip = (story) => story.title.startsWith("Film review");

  await runJob(createFetch({ skip }));

  const titles = listCardTitles(docs.stored.get("news/cards")).flat();
  assert.ok(titles.length > 0);
  assert.ok(!titles.some((title) => title.startsWith("Film review")));
});

// The second batch comes after the first batch's twelve stories each lead a card.
const isSecondBatch = (cards) => cards.length === 12;

// The first card's news, told again by the first story of the second batch.
const tellFirstCardAgain = (lead) => (story, cards) =>
  isSecondBatch(cards) && story.id === cards.length + 1 ? { same: 1, lead } : {};

test("a story that adds to a card's news goes under its lead", async () => {
  const requests = [];
  const { docs, runJob } = createRun();

  await runJob(createFetch({ requests, place: tellFirstCardAgain(false) }));

  const [first, second] = requests.map((request) => request.body.messages[0].content);
  const lead = readStories(first)[0].title;
  const added = readStories(second)[0].title;
  const titles = listCardTitles(docs.stored.get("news/cards"));
  assert.equal(titles.length, 31);
  assert.deepEqual(
    titles.find(([title]) => title === lead),
    [lead, added],
  );
});

test("a story that tells a card's news better leads it, and the stories that led and were under it go under it", async () => {
  const requests = [];
  const { docs, runJob } = createRun();
  // In the second batch, the first new story goes under the first card, and the next leads it.
  const place = (story, cards) => {
    if (!isSecondBatch(cards)) return {};
    if (story.id === cards.length + 1) return { same: 1, lead: false };
    if (story.id === cards.length + 2) return { same: 1, lead: true };
    return {};
  };

  await runJob(createFetch({ requests, place }));

  const [first, second] = requests.map((request) => request.body.messages[0].content);
  const [oldLead] = readStories(first).map((story) => story.title);
  const [added, better] = readStories(second).map((story) => story.title);
  const titles = listCardTitles(docs.stored.get("news/cards"));
  assert.equal(titles.length, 30);
  const card = titles.find(([title]) => title === better);
  assert.deepEqual(card.toSorted(), [better, oldLead, added].toSorted());
  assert.ok(!titles.some(([title]) => title === oldLead));
});

test("a new story can tell the news of an earlier one in its batch", async () => {
  const { docs, runJob } = createRun();
  const place = (story, cards) =>
    story.id === cards.length + 2 ? { same: cards.length + 1, lead: true } : {};

  await runJob(createFetch({ place }));

  const titles = listCardTitles(docs.stored.get("news/cards"));
  assert.equal(titles.length, 29);
  assert.equal(titles.filter((card) => card.length === 2).length, 3);
});

/** @param {{ body: any }[]} requests */
const listAskedTitles = (requests) =>
  requests
    .flatMap((request) => readStories(request.body.messages[0].content).map((story) => story.title))
    .sort();

test("when Claude's prompt changes, every story it judged is judged again", async () => {
  const { storage, runJob } = createRun();
  const firstRequests = [];
  await runJob(createFetch({ requests: firstRequests }));
  await storage.put("rules", "an earlier prompt");
  const requests = [];

  await runJob(createFetch({ requests }));

  assert.deepEqual(listAskedTitles(requests), listAskedTitles(firstRequests));
});

test("the topics a store kept before are removed", async () => {
  const { docs, runJob } = createRun();
  await docs.write("news/topics", { topics: [] });

  await runJob(createFetch());

  assert.equal(docs.stored.has("news/topics"), false);
});

test("the status counts each day's calls and tokens and the run's requests, and names the feeds that didn't answer", async () => {
  const { docs, runJob } = createRun();
  const readFeed = createFetch();

  let requests = 0;
  await runJob(async (url, init) => {
    requests += 1;
    return String(url).includes("winsidr")
      ? new Response("down", { status: 503 })
      : readFeed(url, init);
  });

  const status = docs.stored.get("news/status");
  assert.deepEqual(status.missing, ["winsidr"]);
  assert.equal(status.requests, requests);
  assert.equal(status.lastFailure, null);
  assert.equal(status.problem, "");
  assert.deepEqual(status.usage["2026-10-05"], {
    calls: 3,
    input: 300,
    output: 150,
    cacheRead: 2700,
    cacheWrite: 0,
  });
});

test("a story Claude didn't answer for waits for the next run, and one it labeled isn't asked about again", async () => {
  const { storage, runJob } = createRun();
  const ignore = (story) => story.title.startsWith("Film review");

  await runJob(createFetch({ ignore }));
  const waiting = listStoryStates(storage).filter((state) => state === "pending").length;
  const requests = [];
  await runJob(createFetch({ requests }));

  const asked = requests.flatMap((request) =>
    readStories(request.body.messages[0].content).map((story) => story.title),
  );
  assert.ok(waiting > 0);
  assert.ok(asked.some((title) => title.startsWith("Film review")));
  assert.equal(asked.length, waiting);
});

test("without an API key nothing is asked, and the status says why", async () => {
  const requests = [];
  const { docs, storage, runJob } = createRun({ env: {} });

  await runJob(createFetch({ requests }));

  assert.equal(requests.length, 0);
  assert.match(docs.stored.get("news/status").problem, /ANTHROPIC_API_KEY/);
  assert.deepEqual(docs.stored.get("news/cards"), { cards: [] });
  assert.ok(listStoryStates(storage).includes("pending"));
});

test("a run whose call to Claude fails says so, and keeps saying it last failed, and its stories wait for the next run", async () => {
  const { docs, storage, runJob } = createRun();

  await runJob(createFetch({ status: 529 }));
  assert.equal(docs.stored.get("news/status").problem, "Claude answered 529: Overloaded");
  assert.ok(!listStoryStates(storage).includes("kept"));

  const failed = docs.stored.get("news/status").lastFailure;
  assert.equal(failed.message, "Claude answered 529: Overloaded");

  await runJob(createFetch());
  assert.equal(docs.stored.get("news/status").problem, "");
  assert.deepEqual(docs.stored.get("news/status").lastFailure, failed);
  assert.ok(listStoryStates(storage).includes("kept"));
});

test("a story older than ten days is forgotten", async () => {
  const { storage, runJob } = createRun();
  const old = { id: "old", state: "kept", publishedAt: "2026-09-20T12:00:00.000Z" };
  await storage.put("story:old", old);

  await runJob(createFetch());

  assert.equal(storage.stored.has("story:old"), false);
});

test("the news is read every fifteen minutes by day and hourly overnight, Eastern", () => {
  const job = createWnbaNewsJob();
  assert.equal(job.chooseDelay(Date.parse("2026-10-05T14:00:00Z")), 15 * 60 * 1000);
  assert.equal(job.chooseDelay(Date.parse("2026-10-05T07:00:00Z")), 60 * 60 * 1000);
});

test("an overnight wait ends at 7 a.m. Eastern, in and out of daylight time", () => {
  const job = createWnbaNewsJob();
  assert.equal(job.chooseDelay(Date.parse("2026-10-05T10:30:00Z")), 30 * 60 * 1000);
  assert.equal(job.chooseDelay(Date.parse("2026-10-05T10:45:00Z")), 15 * 60 * 1000);
  assert.equal(job.chooseDelay(Date.parse("2027-01-10T11:40:00Z")), 20 * 60 * 1000);
});

test("Claude answers in the schema, and a run whose answer Claude didn't finish saves the problem", async () => {
  const requests = [];
  const { docs, runJob } = createRun();

  await runJob(createFetch({ requests, stopReason: "max_tokens" }));

  assert.deepEqual(requests[0].body.output_config, {
    format: { type: "json_schema", schema: LABELS_SCHEMA },
  });
  assert.equal(
    docs.stored.get("news/status").problem,
    "Claude stopped without finishing: max_tokens",
  );
});

// Claude judges every story again when its prompt changes, so the prompt changes only on purpose,
// with this hash.
test("the WNBA's prompt is the one its stories were last judged by", () => {
  const hash = createHash("sha256").update(LABEL_PROMPT).digest("hex").slice(0, 16);
  assert.equal(hash, "5a56822c8c0fb6d6");
});
