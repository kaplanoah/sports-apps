import { test } from "node:test";
import assert from "node:assert/strict";
import { noteFailedImage } from "../shared/page/failed-images.js";
import { formatClipLength, renderHighlights } from "../shared/page/highlights-view.js";
import { stripTags } from "./text.js";

const NOW = Date.parse("2026-10-08T12:00:00Z");

/** @param {any} markup */
const readText = (markup) =>
  stripTags(markup)
    .replace(/&#39;/g, "'")
    .replace(/&bull;/g, "|")
    .replace(/\s+/g, " ")
    .trim();

/**
 * @param {string} title
 * @param {object} [fields]
 */
const describeClip = (title, fields = {}) => ({
  title,
  length: 30,
  still: `https://img.test/${title.length}.jpg`,
  video: `https://video.test/${title.length}.mp4`,
  ...fields,
});

const HIGHLIGHTS = {
  recap: {
    ...describeClip("Brewers vs. Padres Game 3 Highlights", { length: 181 }),
    blurb: "Cronenworth homers",
  },
  story: {
    title: "Padres force Game 4",
    lead: "SAN DIEGO -- The Padres found a way.",
    url: "https://www.mlb.com/news/padres-force-game-4",
    outlet: "MLB.com",
  },
  plays: [
    describeClip("Jackson Merrill's sliding catch", { inning: 1 }),
    describeClip("Manny Machado's RBI single", { inning: 3, score: "SD 2" }),
  ],
};

/** @param {any} clip */
const describePlay = (clip) => [`Inning ${clip.inning}`, clip.score];

test("a clip's length reads in minutes and seconds", () => {
  assert.equal(formatClipLength(181), "3:01");
  assert.equal(formatClipLength(7), "0:07");
  assert.equal(formatClipLength(1200), "20:00");
  assert.equal(formatClipLength(null), "");
});

test("the section is the recap video, then the story with a button to read it, then each play", () => {
  const markup = renderHighlights(HIGHLIGHTS, { describePlay, now: NOW });

  assert.equal(
    readText(markup),
    [
      "3:01 Brewers vs. Padres Game 3 Highlights Cronenworth homers",
      "Story Padres force Game 4 SAN DIEGO -- The Padres found a way. Read on MLB.com",
      "Plays 0:30 Jackson Merrill's sliding catch Inning 1",
      "0:30 Manny Machado's RBI single Inning 3|SD 2",
    ].join(" "),
  );
  assert.match(
    markup.text,
    /<a\s+class="read-button"\s+href="https:\/\/www\.mlb\.com\/news\/padres-force-game-4"/,
  );
});

test("each clip is a button that names it and carries its video", () => {
  const markup = renderHighlights(HIGHLIGHTS, { describePlay, now: NOW }).text;

  assert.match(
    markup,
    /<button\s+type="button"\s+class="clip-open clip-row"\s+data-video="https:\/\/video\.test\/26\.mp4"\s+aria-label="Play Manny Machado&#39;s RBI single, 0:30"/,
  );
  assert.equal(markup.match(/class="clip-open/g)?.length, 3);
});

test("a clip the league has taken down leaves the list", () => {
  const highlights = {
    ...HIGHLIGHTS,
    plays: [
      describeClip("Taken down", { expiresAt: "2026-10-08T11:00:00Z" }),
      describeClip("Still up", { expiresAt: "2026-10-09T00:00:00Z" }),
    ],
  };

  const text = readText(renderHighlights(highlights, { describePlay, now: NOW }));

  assert.match(text, /Still up/);
  assert.doesNotMatch(text, /Taken down/);
});

test("a clip whose video isn't a web address leaves the list", () => {
  const highlights = {
    ...HIGHLIGHTS,
    plays: [describeClip("Odd", { video: "javascript:alert(1)" })],
  };

  assert.doesNotMatch(readText(renderHighlights(highlights, { describePlay, now: NOW })), /Odd/);
});

test("a game with no clips or story yet says so", () => {
  const markup = renderHighlights(
    { recap: null, story: null, plays: [] },
    { describePlay, now: NOW },
  );

  assert.equal(readText(markup), "No highlights for this game yet");
});

test("a still that didn't load is left out, and its clip still plays", () => {
  const clip = describeClip("Moved still", { inning: 2, still: "https://img.test/moved.jpg" });
  const highlights = { recap: null, story: null, plays: [clip] };

  noteFailedImage(clip.still);

  const markup = renderHighlights(highlights, { describePlay, now: NOW }).text;
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /class="clip-still"[\s\S]*class="clip-play"/);
  assert.match(markup, /data-video="https:\/\/video\.test\/11\.mp4"/);
});
