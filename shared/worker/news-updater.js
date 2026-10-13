import { isSameJson } from "../page/compare.js";
import { readEasternDay } from "../page/days.js";
import { isWebAddress } from "../page/news-picks.js";
import { hashText } from "./hash-text.js";
import { countRequests, describeJobRun } from "./job-status.js";
import { askClaude } from "./news-claude.js";
import { frameNewsPhotos } from "./news-photos.js";
import { describeError } from "./responses.js";

// Keeps the news the page shows: each run reads the outlets' feeds, drops what the rules can tell
// isn't news, and has Claude judge the rest against the cards the feed has so far. A story with news
// of its own leads a card, one that tells a card's news better takes it over, and one that adds to
// it goes under its lead. A story Claude hasn't answered for stays waiting and is asked about again
// on the next run, so a run that fails loses nothing. The cards go in `news/cards`, newest lead
// first, where each page picks the stories from the outlets its device reads, and how the runs are
// going, with Claude's daily token counts and each run's requests, in `news/status`. Each card's
// photo carries its size and, for one taller than its frame, where Claude says its subject is
// (news-photos.js). Each league hands it its outlets, the prompt Claude judges by, its teams' codes,
// and the rules that drop what isn't news.

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const SHOWN_MS = 7 * DAY_MS;
// Stories are kept a little past when they're shown, so one that a feed still lists isn't asked
// about again.
const KEPT_MS = 10 * DAY_MS;
const USAGE_DAYS = 30;
const MORNING_HOUR = 7;
const DAY_DELAY_MS = 15 * MINUTE_MS;
const NIGHT_DELAY_MS = 60 * MINUTE_MS;
const LABEL_BATCH = 12;
const MAX_CARDS = 60;
const CARDS_KEY = "news/cards";
// A document no page reads, removed from any store that still keeps it.
const OLD_TOPICS_KEY = "news/topics";
const STATUS_KEY = "news/status";
const RULES_KEY = "rules";

/**
 * A story the news has seen, as it's kept.
 * @typedef {object} NewsStory
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string} summary
 * @property {string} author
 * @property {string} outlet
 * @property {string} source
 * @property {string} [teamFeed]
 * @property {string} publishedAt
 * @property {string} firstSeenAt
 * @property {{ url: string, credit: string } | null} photo as its feed gives it
 * @property {string} [espnType]
 * @property {"pending" | "kept" | "dropped"} state
 * @property {string} [why]
 * @property {string[]} [teams]
 * @property {string} [reason]
 * @property {string} [under] the story that leads the card this one is under
 */

/**
 * The wait between runs: every fifteen minutes from 7 a.m. Eastern to midnight, and hourly overnight,
 * but never past 7 a.m., when a morning reader comes for what was written overnight.
 */
function chooseNewsDelay(now) {
  const { hour } = readEasternDay(now);
  if (hour >= MORNING_HOUR) return DAY_DELAY_MS;
  // Eastern time is a whole number of hours off UTC, so its minutes are UTC's.
  const untilMorningMs = ((MORNING_HOUR - hour) * 60 - new Date(now).getUTCMinutes()) * MINUTE_MS;
  return Math.min(NIGHT_DELAY_MS, untilMorningMs);
}

/**
 * @param {import("./season-store.js").JobContext["storage"]} storage
 * @returns {Promise<Map<string, NewsStory>>}
 */
async function readStories(storage) {
  const stored = await storage.list("story:");
  return new Map([...stored.values()].map((story) => [story.id, story]));
}

/**
 * @param {import("./season-store.js").JobContext["storage"]} storage
 * @param {Map<string, NewsStory>} stories
 * @param {NewsStory[]} changed
 */
async function saveStories(storage, stories, changed) {
  for (const story of changed) {
    stories.set(story.id, story);
    await storage.put(`story:${story.id}`, story);
  }
}

// A feed edits a story's time when it edits the story, so a story keeps the first time it's seen
// with, and is never dated ahead of when it's seen.
function readPublishedAt(entry, now) {
  const published = Date.parse(entry.publishedAt);
  return new Date(Number.isNaN(published) ? now : Math.min(published, now)).toISOString();
}

/**
 * @param {import("./news-feeds.js").NewsEntry} entry
 * @param {string} id
 * @param {number} now
 * @param {NewsLeague["readRuleDrop"]} readRuleDrop
 * @returns {NewsStory}
 */
function createStory(entry, id, now, readRuleDrop) {
  const why = readRuleDrop(entry);
  return {
    id,
    url: entry.url,
    title: entry.title,
    summary: entry.summary,
    author: entry.author,
    outlet: entry.outlet,
    source: entry.source,
    ...(entry.teamFeed && { teamFeed: entry.teamFeed }),
    publishedAt: readPublishedAt(entry, now),
    firstSeenAt: new Date(now).toISOString(),
    photo: entry.photo,
    ...(entry.espnType && { espnType: entry.espnType }),
    state: why ? "dropped" : "pending",
    ...(why && { why }),
  };
}

async function addNewStories({ storage, stories, entries, now, league }) {
  for (const entry of entries) {
    const id = await hashText(entry.url);
    if (stories.has(id)) continue;
    const story = createStory(entry, id, now, league.readRuleDrop);
    if (now - Date.parse(story.publishedAt) > SHOWN_MS) continue;
    await saveStories(storage, stories, [story]);
  }
}

async function forgetOldStories(storage, stories, now) {
  for (const story of [...stories.values()]) {
    if (now - Date.parse(story.publishedAt) <= KEPT_MS) continue;
    stories.delete(story.id);
    await storage.delete(`story:${story.id}`);
  }
}

const isShownAge = (story, now) => now - Date.parse(story.publishedAt) <= SHOWN_MS;

const byNewest = (first, second) => Date.parse(second.publishedAt) - Date.parse(first.publishedAt);

const byOldest = (first, second) => byNewest(second, first);

const describeForClaude = (story, index) => ({
  id: index + 1,
  title: story.title,
  outlet: story.outlet,
  author: story.author,
  summary: story.summary,
});

/**
 * A story with Claude's label, or null when the answer doesn't say whether to keep it.
 * @param {NewsStory} story
 * @param {any} answer
 * @param {string[]} teamCodes
 * @returns {NewsStory | null}
 */
function applyLabel(story, answer, teamCodes) {
  if (typeof answer?.keep !== "boolean") return null;
  return {
    ...story,
    state: answer.keep ? "kept" : "dropped",
    ...(!answer.keep && { why: String(answer.why || "other") }),
    teams: Array.isArray(answer.teams)
      ? answer.teams.filter((code) => teamCodes.includes(code))
      : [],
    reason: String(answer.reason ?? ""),
  };
}

/**
 * A story as it was before Claude judged it.
 * @param {NewsStory} story
 * @returns {NewsStory}
 */
const clearJudgment = ({ state, why, teams, reason, under, ...story }) => ({
  ...story,
  state: "pending",
});

// Claude judges every story again when its prompt changes, so the cards follow the rules it's
// asked by.
async function judgeAgainOnNewRules(storage, stories, prompt) {
  const rules = await hashText(prompt);
  if ((await storage.get(RULES_KEY)) === rules) return;
  const judged = [...stories.values()].filter((story) => story.reason !== undefined);
  await saveStories(storage, stories, judged.map(clearJudgment));
  await storage.put(RULES_KEY, rules);
}

/**
 * Each story in `batch` with the answer Claude gave for it by its number, which comes after the
 * cards' numbers.
 */
function matchAnswers(batch, answers, cardCount) {
  const byId = new Map(answers.map((answer) => [Number(answer?.id), answer]));
  return batch.map((story, index) => [story, byId.get(cardCount + index + 1)]);
}

function splitIntoBatches(stories, size) {
  const batches = [];
  for (let start = 0; start < stories.length; start += size)
    batches.push(stories.slice(start, start + size));
  return batches;
}

const listShownStories = (stories, now) =>
  [...stories.values()].filter((story) => story.state === "kept" && isShownAge(story, now));

/**
 * The cards the feed shows, oldest lead first: each lead with the stories under it, newest first.
 * A story whose lead is no longer shown leads in its place.
 * @param {Map<string, NewsStory>} stories
 * @param {number} now
 */
function listCards(stories, now) {
  /** @type {Map<string, NewsStory[]>} */
  const byLead = new Map();
  for (const story of listShownStories(stories, now).sort(byNewest)) {
    const leadId = story.under ?? story.id;
    byLead.set(leadId, [...(byLead.get(leadId) ?? []), story]);
  }
  return [...byLead]
    .map(([leadId, group]) => {
      const lead = group.find((story) => story.id === leadId) ?? group[0];
      return { lead, more: group.filter((story) => story !== lead) };
    })
    .sort((first, second) => byOldest(first.lead, second.lead));
}

const describeToldStory = (story) => ({ title: story.title, outlet: story.outlet });

const describeCard = ({ lead, more }, index) => ({
  id: index + 1,
  ...describeToldStory(lead),
  more: more.map(describeToldStory),
});

/** What Claude reads for a batch: the cards the feed has so far, then the new stories. */
const describeBatch = (cards, batch) =>
  `Cards so far:\n${JSON.stringify(cards.map(describeCard))}\n\nNew stories:\n${JSON.stringify(batch.map((story, index) => describeForClaude(story, cards.length + index)))}`;

/**
 * The kept story Claude's `same` names, by its number among the cards' leads and the new stories,
 * or null when it names none.
 * @param {Map<string, NewsStory>} stories
 * @param {NewsStory[]} numbered
 * @param {NewsStory} story
 * @param {unknown} same
 */
function findSameStory(stories, numbered, story, same) {
  const named = numbered[Number(same) - 1];
  const current = named && named.id !== story.id ? stories.get(named.id) : null;
  return current?.state === "kept" ? current : null;
}

/**
 * The stories a kept story changes as it joins the card whose news it tells: itself under the
 * card's lead, or, when it leads, the card's lead and every story under it, under it.
 * @param {Map<string, NewsStory>} stories
 * @param {NewsStory} story
 * @param {NewsStory} same
 * @param {boolean} leads
 */
function joinCard(stories, story, same, leads) {
  const leadId = same.under ?? same.id;
  if (!leads) return [{ ...story, under: leadId }];
  const demoted = [...stories.values()]
    .filter((other) => other.id === leadId || other.under === leadId)
    .map((other) => ({ ...other, under: story.id }));
  return [story, ...demoted];
}

/**
 * @param {Map<string, NewsStory>} stories
 * @param {NewsStory[]} numbered
 * @param {NewsStory} story
 * @param {any} answer
 * @param {string[]} teamCodes
 */
function placeStory(stories, numbered, story, answer, teamCodes) {
  const labeled = applyLabel(story, answer, teamCodes);
  if (!labeled) return [];
  const same = labeled.state === "kept" && findSameStory(stories, numbered, story, answer.same);
  return same ? joinCard(stories, labeled, same, answer.lead === true) : [labeled];
}

// Every waiting story is asked about in one run, so a week judged again catches up at once, and in
// the order they came out, so a story that tells news an earlier one told can lead only by telling
// it better.
async function labelWaitingStories({ storage, stories, ask, now, league }) {
  const waiting = [...stories.values()]
    .filter((story) => story.state === "pending" && isShownAge(story, now))
    .sort(byOldest);
  for (const batch of splitIntoBatches(waiting, LABEL_BATCH)) {
    const cards = listCards(stories, now);
    const numbered = [...cards.map((card) => card.lead), ...batch];
    const answers = await ask(league.prompt, describeBatch(cards, batch));
    for (const [story, answer] of matchAnswers(batch, answers, cards.length))
      await saveStories(
        storage,
        stories,
        placeStory(stories, numbered, story, answer, league.teamCodes),
      );
  }
}

const addUsage = (total, usage) => ({
  calls: (total?.calls ?? 0) + 1,
  input: (total?.input ?? 0) + (usage.input_tokens ?? 0),
  output: (total?.output ?? 0) + (usage.output_tokens ?? 0),
  cacheRead: (total?.cacheRead ?? 0) + (usage.cache_read_input_tokens ?? 0),
  cacheWrite: (total?.cacheWrite ?? 0) + (usage.cache_creation_input_tokens ?? 0),
});

/** Asks Claude, counting each day's tokens under the league's Eastern day. */
function createClaudeAsker({ env, fetchImpl, storage, now }) {
  return async (prompt, content) => {
    const { answers, usage } = await askClaude({
      apiKey: env.ANTHROPIC_API_KEY,
      fetchImpl,
      prompt,
      content,
    });
    const key = `usage:${readEasternDay(now).date}`;
    await storage.put(key, addUsage(await storage.get(key), usage));
    return answers;
  };
}

/** What went wrong asking Claude, or "" when nothing did. */
async function curateStories(context) {
  if (!context.env.ANTHROPIC_API_KEY)
    return "No ANTHROPIC_API_KEY secret, so no story was labeled.";
  const ask = createClaudeAsker(context);
  try {
    await labelWaitingStories({ ...context, ask });
    return "";
  } catch (error) {
    return describeError(error);
  }
}

/**
 * The story's photo with its size and frame, once read.
 * @param {NewsStory["photo"]} photo
 * @param {Map<string, import("./news-photos.js").PhotoFrame>} frames
 */
function describePhoto(photo, frames) {
  if (!photo) return null;
  const { width, height, frameTop } = frames.get(photo.url) ?? {};
  return {
    ...photo,
    ...(width && height && { width, height }),
    ...(frameTop !== undefined && { frameTop }),
  };
}

/**
 * @param {NewsStory} story
 * @param {Map<string, import("./news-photos.js").PhotoFrame>} frames
 */
const describeShownStory = (story, frames) => ({
  id: story.id,
  url: story.url,
  title: story.title,
  summary: story.summary,
  author: story.author,
  outlet: story.outlet,
  source: story.source,
  ...(story.teamFeed && { teamFeed: story.teamFeed }),
  publishedAt: story.publishedAt,
  photo: describePhoto(story.photo, frames),
  teams: story.teams ?? [],
});

/** The cards the page shows, newest lead first. */
const listShownCards = (stories, now) => listCards(stories, now).reverse().slice(0, MAX_CARDS);

/** The cards' photos, newest card's first. */
const listCardPhotos = (cards) => [
  ...new Set(
    cards
      .flatMap(({ lead, more }) => [lead, ...more])
      .map((story) => story.photo?.url)
      .filter(isWebAddress),
  ),
];

async function saveCards(docs, shownCards, frames) {
  const cards = shownCards.map(({ lead, more }) => ({
    lead: describeShownStory(lead, frames),
    more: more.map((story) => describeShownStory(story, frames)),
  }));
  const stored = await docs.read(CARDS_KEY);
  if (!isSameJson(stored?.cards, cards)) await docs.write(CARDS_KEY, { cards });
  if (await docs.read(OLD_TOPICS_KEY)) await docs.remove(OLD_TOPICS_KEY);
}

async function readRecentUsage(storage, now) {
  const usage = {};
  for (const [key, counts] of await storage.list("usage:")) {
    const date = key.slice("usage:".length);
    if (now - Date.parse(`${date}T12:00:00Z`) > USAGE_DAYS * DAY_MS) await storage.delete(key);
    else usage[date] = counts;
  }
  return usage;
}

async function saveStatus({ docs, storage, now, endedAt, requests, missing, problem, photos }) {
  const stored = await docs.read(STATUS_KEY);
  await docs.write(STATUS_KEY, {
    ...describeJobRun({ startedAt: now, endedAt, requests, failure: problem }, stored),
    missing,
    problem,
    photos,
    usage: await readRecentUsage(storage, now),
  });
}

/**
 * One run of the news.
 * @param {import("./season-store.js").JobContext} context
 * @param {NewsLeague} league
 */
async function updateNews(context, league) {
  const { docs, storage, env, now: readNow } = context;
  const now = readNow();
  const counter = countRequests(context.fetchImpl);
  const { fetchImpl } = counter;
  const { entries, missing } = await league.readFeeds(fetchImpl);
  const stories = await readStories(storage);
  await addNewStories({ storage, stories, entries, now, league });
  await forgetOldStories(storage, stories, now);
  await judgeAgainOnNewRules(storage, stories, league.prompt);
  const problem = await curateStories({ storage, stories, env, fetchImpl, now, league });
  const cards = listShownCards(stories, now);
  const { frames, framed, failed } = await frameNewsPhotos(
    { storage, env, fetchImpl },
    listCardPhotos(cards),
  );
  await saveCards(docs, cards, frames);
  await saveStatus({
    docs,
    storage,
    now,
    endedAt: readNow(),
    requests: counter.count,
    missing,
    problem,
    photos: { framed, failed },
  });
}

/**
 * What a league hands the news.
 * @typedef {object} NewsLeague
 * @property {(fetchImpl: typeof fetch) => Promise<{ entries: import("./news-feeds.js").NewsEntry[], missing: string[] }>} readFeeds
 * @property {string} prompt what Claude judges each story by
 * @property {string[]} teamCodes the codes Claude may tag a story with
 * @property {(story: { url: string, title: string, espnType?: string }) => string | null} readRuleDrop
 */

/**
 * @param {NewsLeague} league
 * @returns {import("./season-store.js").BackgroundJob}
 */
export const createNewsJob = (league) => ({
  chooseDelay: chooseNewsDelay,
  updateStore: (context) => updateNews(context, league),
});
