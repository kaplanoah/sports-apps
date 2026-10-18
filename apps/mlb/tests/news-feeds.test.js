import test from "node:test";
import assert from "node:assert/strict";
import { parseNewsSitemap } from "../../../shared/worker/news-parse.js";
import { NEWS_FEEDS, readMlbNews } from "../worker/src/news-feeds.js";
import { readMlbRuleDrop } from "../worker/src/news-updater.js";
import { createFeedFetch, readFixture } from "./news-fixtures.js";

test("SNY's news sitemap reads each story's link, title, time, and photo", () => {
  const [story] = parseNewsSitemap(readFixture("sny-mets"));
  assert.deepEqual(story, {
    url: "https://sny.tv/articles/mlb-proposed-changes-10-8-26",
    title: "MLB proposes drastic changes, including 154-game season and big playoff tweaks",
    summary: "",
    author: "",
    publishedAt: "2026-10-08T06:40:00.000Z",
    photo: {
      url: "https://images.contentstack.io/v3/assets/bltf7a82b39b0908da4/blt6efd48aa8eda7fcd/6ac7e309d05602e46e2953b0/Manfred.JPG",
      credit: "",
    },
  });
});

test("a story only the Mets' own outlets carry is marked as theirs, and one a league feed carries too isn't", async () => {
  const { entries } = await readMlbNews(createFeedFetch());
  const fired = entries.find((entry) => entry.title.startsWith("Mets fire hitting coach"));
  assert.equal(fired.teamFeed, "NYM");
  assert.equal(fired.outlet, "NY Post");
  const coaches = entries.filter((entry) =>
    entry.title.startsWith("Mets make changes to MLB coaching staff"),
  );
  assert.equal(coaches.length, 1);
  assert.equal(coaches[0].teamFeed, undefined);
});

test("reading the news asks each outlet once, and names the ones that didn't answer", async () => {
  const urls = [];
  const readFeed = createFeedFetch(["mlbtr"]);
  const { missing } = await readMlbNews(async (url) => {
    urls.push(String(url));
    return readFeed(url);
  });
  assert.deepEqual(urls.toSorted(), NEWS_FEEDS.map((feed) => feed.url).toSorted());
  assert.ok(missing.includes("mlbtr"));
  assert.ok(missing.includes("dailynews-mets"));
});

test("MLB's rules drop The Athletic's MLB newsletter and MLB Trade Rumors' reader polls", () => {
  const windup = {
    url: "https://www.nytimes.com/athletic/7683853/2026/10/12/jacob-misiorowski-tarik-skubal-brewers-dodgers-nlcs-game-1-the-windup/",
    title: "How 'bout that pitching duel? NLCS Game 1 breakdown, plus ALCS preview",
  };
  const poll = {
    url: "https://www.mlbtraderumors.com/2026/10/poll-will-bo-bichette-opt-out.html",
    title: "Poll: Will Bo Bichette Opt Out?",
  };
  const story = {
    url: "https://www.mlbtraderumors.com/2026/10/miguel-rojas-announces-retirement.html",
    title: "Miguel Rojas Announces Retirement",
  };
  assert.equal(readMlbRuleDrop(windup), "newsletter");
  assert.equal(readMlbRuleDrop(poll), "poll");
  assert.equal(readMlbRuleDrop(story), null);
});

test("MLB's rules drop fantasy pages, Spanish copies, link roundups, chats, and podcasts, as well as what every league's drop", async () => {
  const { entries } = await readMlbNews(createFeedFetch());
  const dropped = entries
    .map((entry) => [readMlbRuleDrop(entry), entry.title])
    .filter(([why]) => why)
    .map(([why, title]) => `${why}: ${title}`);
  assert.deepEqual(dropped.toSorted(), [
    "betting: Every team's odds to win the 2026 World Series: Dodgers still favorites",
    "chat: Front Office Subscriber Chat With Anthony Franco: TODAY At 4:00pm Central",
    "fantasy: What They’re Saying ’26: David Stearns End-Of-Year Edition",
    "newsletter: A tale of two robberies, plus grilled cheese poll results",
    "podcast: PosCasting Just in Time for the ALDS & NLDS (kind of)",
    "quiz: Solve today's Mets trivia puzzle",
    "quiz: This Week in Sports Trivia: Oct. 8, 2026",
    "recap: Jose Ramirez homers as the Guardians beat the White Sox 9-5 to force a decisive Game 5 in ALDS",
    "reference: Latest Mets injuries & transactions",
    "roundup: Mets Morning News: Guardians force Game 5 in ALDS",
    "roundup: The Opener: Ramirez, Taylor, MLB Proposal",
    "schedule: 2026 MLB playoffs: Schedule, postseason bracket, standings",
    "schedule: ALDS Game 4: Schedule, probable pitchers, and open thread, 10/8/26",
    "translation: El mes que fue: septiembre de 2026",
    "video: Cleveland Guardians vs. Chicago White Sox: Game Highlights",
  ]);
});
