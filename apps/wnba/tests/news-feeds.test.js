import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAtom,
  parseEspnNews,
  parseRss,
  shortenSummary,
} from "../../../shared/worker/news-parse.js";
import { createRuleDrop } from "../../../shared/worker/news-rules.js";
import { readWnbaNews } from "../worker/src/news-feeds.js";
import { createFeedFetch, readFixture } from "./news-fixtures.js";

test("news reads identify the app without inheriting a browser from sports requests", async () => {
  const readRecordedFeed = createFeedFetch();
  const headers = [];
  const { entries, missing } = await readWnbaNews(async (url, init) => {
    headers.push(init.headers);
    return readRecordedFeed(url);
  });
  assert.equal(missing.length, 0);
  assert.ok(entries.length > 0);
  assert.equal(headers.length, 7);
  for (const header of headers) {
    assert.equal(header["user-agent"], "sports-apps");
    assert.deepEqual(Object.keys(header).sort(), ["accept", "user-agent"]);
  }
});

test("an RSS story reads its title, a short summary without the outlet's sign-off, its writer, and its photo", () => {
  const [story] = parseRss(readFixture("ix"));
  assert.deepEqual(story, {
    url: "https://www.theixsports.com/features/film-review-how-the-dream-changed-their-approach-against-the-liberty/",
    title: "Film review: How the Dream changed their approach against the Liberty",
    summary:
      "The teams went 102 games between playing each other, and a lot changed during that time.",
    author: "Michael Waterloo",
    publishedAt: "2026-10-03T13:04:20.000Z",
    photo: {
      url: "https://www.theixsports.com/wp-content/uploads/2025/07/USATSI_26558408-1-scaled.jpg",
      credit: "USA TODAY Sports",
    },
  });
});

test("a story's title has its entities read as the characters they stand for", () => {
  const titles = parseRss(readFixture("ix-liberty")).map((story) => story.title);
  assert.ok(
    titles.includes(
      "The New York Liberty\u2019s Game 2 victory over the Lynx, told like a procedural melodrama",
    ),
  );
});

test("a photo the feed gives as an enclosure has its escaped path read back", () => {
  const photos = parseRss(readFixture("nypost")).map((story) => story.photo?.url);
  assert.ok(photos.every((url) => !url || !url.includes("%2F")));
  assert.ok(photos.some((url) => url?.startsWith("https://nypost.com/wp-content/uploads/")));
});

test("an ESPN story takes its writer from the byline, and its photo's credit without 'Photo by'", () => {
  const [story] = parseEspnNews(JSON.parse(readFixture("espn")));
  assert.equal(story.title, "Lacob lauds Williams as world's best after Valkyries' Game 1 win");
  assert.equal(story.author, "Kendra Andrews");
  assert.equal(story.espnType, "HeadlineNews");
  assert.ok(story.photo.url.startsWith("https://"));
  assert.doesNotMatch(story.photo.credit, /^Photo by/);
});

test("an Atom story reads its link, title, summary, and writer", () => {
  const [story] = parseAtom(readFixture("netsdaily"));
  assert.equal(
    story.url,
    "https://www.netsdaily.com/nyliberty/114345/liberty-vs-dream-semifinals-game-1-breanna-stewart-angel-reese",
  );
  assert.equal(story.title, "Liberty vs. Dream Preview: New York, Atlanta open WNBA semifinals");
  assert.match(story.summary, /^The journey continues\./);
  assert.ok(story.author);
});

test("a summary keeps whole sentences, and doesn't end at an initial or an abbreviation", () => {
  const long = `In the semifinals, the No. 2 Valkyries face the No. 3 Aces after both survived three games. ${"More words follow here. ".repeat(8)}`;
  assert.equal(
    shortenSummary(long),
    "In the semifinals, the No. 2 Valkyries face the No. 3 Aces after both survived three games. More words follow here. More words follow here. More words follow here.",
  );
  assert.equal(shortenSummary("C.J. Holmes reports it."), "C.J. Holmes reports it.");
});

test("reading the feeds keeps only the Liberty's stories from NetsDaily, and says which feeds didn't answer", async () => {
  const { entries, missing } = await readWnbaNews(createFeedFetch(["winsidr"]));
  assert.deepEqual(missing, ["winsidr"]);
  const netsDaily = entries.filter((entry) => entry.source === "netsdaily");
  assert.equal(netsDaily.length, 3);
  assert.ok(
    netsDaily.every((entry) => entry.url.includes("/nyliberty/") && entry.teamFeed === "NYL"),
  );
});

test("a story the league's feed carries too isn't marked as the team's own", async () => {
  const { entries } = await readWnbaNews(createFeedFetch());
  const film = entries.filter((entry) => entry.title.startsWith("Film review: How the Dream"));
  assert.equal(film.length, 1);
  assert.equal(film[0].teamFeed, undefined);
  const gameTwo = entries.find((entry) => entry.title.includes("procedural melodrama"));
  assert.equal(gameTwo.teamFeed, "NYL");
});

const readRuleDrop = createRuleDrop();

test("the rules drop video, schedules, betting, newsletters, roundups, and ESPN's recaps and previews", async () => {
  const { entries } = await readWnbaNews(createFeedFetch());
  const dropped = entries
    .map((entry) => [readRuleDrop(entry), entry.title])
    .filter(([why]) => why)
    .map(([why, title]) => `${why}: ${title}`);
  assert.deepEqual(dropped, [
    "video: Valkyries take Game 1 over the Aces",
    "schedule: WNBA playoffs 2026: Schedule, scores for every game",
    "recap: Canada's big day, team defense carries Dream to 92-82 win over Liberty in WNBA semifinals",
    "betting: WNBA championship and Finals MVP odds: Aces back as favorites after ousting Fever",
    "preview: New York Liberty face the Atlanta Dream in Game 1 of the WNBA semifinals",
    "roundup: WNBA offseason 2026: Guides for every eliminated team",
    "schedule: 2026 WNBA semifinals schedule: How to watch Liberty vs. Dream, Aces vs. Valkyries",
    "newsletter: This is just the start. Plus, the Browns might be good",
    "newsletter: New York Liberty decide to \u2018Be who you are\u2019 \u2014 Breanna Stewart talks Game 2 win",
    "video: Liberty vs Dream: Did New York Give Game 1 Away? | Liberty Lately",
    "video: Liberty vs. Dream: Who Advances To The WNBA Finals?",
  ]);
});
