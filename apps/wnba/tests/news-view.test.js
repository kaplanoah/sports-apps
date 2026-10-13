import test from "node:test";
import assert from "node:assert/strict";
import { pickReadCards } from "../../../shared/page/news-picks.js";
import { renderNews as renderLeagueNews } from "../../../shared/page/news-view.js";
import { NEWS_LEAGUE } from "../page/js/news-league.js";
import { checkInTimeZone, EASTERN } from "../../../tests/time-zone.js";

const NOW = Date.parse("2026-10-05T16:00:00Z");

/** The News view with the WNBA's teams and paid outlet. */
const renderNews = (cards, choices, now, options = {}) =>
  renderLeagueNews(cards, choices, now, { ...NEWS_LEAGUE, ...options });
const ALL_ON = { teamOutlets: true, paywalled: true };

/** @param {Partial<import("../../../shared/page/news-picks.js").NewsStory>} fields */
const createStory = (fields) => ({
  id: "story",
  url: `https://example.com/${fields.id ?? "story"}`,
  title: "A story",
  summary: "What happened.",
  author: "",
  outlet: "ESPN",
  source: "espn",
  publishedAt: "2026-10-04T12:00:00.000Z",
  photo: null,
  teams: ["NYL"],
  ...fields,
});

// Each tag reads as a space, and the page's separator as a bar.
const readText = (markup) =>
  markup.text
    .replace(/<[^>]+>/g, " ")
    .replace(/&bull;/g, "|")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A card for each story, with nothing under its lead.
 * @param {import("../../../shared/page/news-picks.js").NewsStory[]} stories
 */
const createCards = (stories) => stories.map((lead) => ({ lead, more: [] }));

/** @param {import("../../../shared/page/news-picks.js").NewsCard[]} cards */
const listShown = (cards) =>
  cards.map(({ lead, more }) => [lead.id, ...more.map((story) => story.id)]);

test("the cards read newest lead first, each with its lead and up to three stories under it", () => {
  const cards = [
    {
      lead: createStory({ id: "older", publishedAt: "2026-10-03T12:00:00.000Z" }),
      more: ["a", "b", "c", "d"].map((id) => createStory({ id })),
    },
    { lead: createStory({ id: "newer", publishedAt: "2026-10-05T12:00:00.000Z" }), more: [] },
  ];

  assert.deepEqual(listShown(pickReadCards(cards, ALL_ON, NEWS_LEAGUE.outletSwitches)), [
    ["newer"],
    ["older", "a", "b", "c"],
  ]);
});

test("without The Athletic or the team's own outlets, their stories are left out, the first story under a left-out lead leads, and a card with none left goes", () => {
  const cards = [
    {
      lead: createStory({ id: "athletic", source: "athletic" }),
      more: [createStory({ id: "espn" }), createStory({ id: "post", teamFeed: "NYL" })],
    },
    { lead: createStory({ id: "athletic-only", source: "athletic" }), more: [] },
  ];

  assert.deepEqual(
    listShown(
      pickReadCards(cards, { teamOutlets: true, paywalled: false }, NEWS_LEAGUE.outletSwitches),
    ),
    [["espn", "post"]],
  );
  assert.deepEqual(
    listShown(
      pickReadCards(cards, { teamOutlets: false, paywalled: true }, NEWS_LEAGUE.outletSwitches),
    ),
    [["athletic", "espn"], ["athletic-only"]],
  );
});

test("a story whose link isn't a web address is never shown, nor a photo whose address isn't", () => {
  const stories = [
    createStory({ id: "script", url: "javascript:alert(1)" }),
    createStory({ id: "plain", photo: { url: "javascript:alert(2)", credit: "AP" } }),
  ];

  const markup = renderNews(createCards(stories), ALL_ON, NOW).text;

  assert.doesNotMatch(markup, /javascript:/);
  assert.match(markup, /href="https:\/\/example\.com\/plain"/);
  assert.doesNotMatch(markup, /<img/);
});

test("a card shows its first two teams, the photo's credit, the headline, writer, outlet, day, and summary", () => {
  const story = createStory({
    id: "film",
    title: "Film review: How the Dream changed",
    author: "Michael Waterloo",
    outlet: "The IX",
    source: "ix",
    teams: ["ATL", "NYL", "MIN"],
    publishedAt: "2026-10-05T13:00:00.000Z",
    photo: { url: "https://example.com/film.jpg", credit: "USA TODAY Sports" },
  });

  const text = checkInTimeZone(EASTERN, () =>
    readText(renderNews(createCards([story]), ALL_ON, NOW)),
  );

  assert.equal(
    text,
    "Dream Liberty Photo: USA TODAY Sports Film review: How the Dream changed " +
      "Michael Waterloo | The IX | Today What happened. Read on The IX",
  );
});

test("under its lead, a card lists the stories that add to it, each by headline, outlet, and day", () => {
  const card = {
    lead: createStory({ id: "lead", title: "The lead", publishedAt: "2026-10-05T13:00:00.000Z" }),
    more: [
      createStory({
        id: "more",
        title: "There's one key element",
        author: "Madeline Kenney",
        outlet: "NY Post",
        source: "nypost",
        publishedAt: "2026-10-04T13:00:00.000Z",
        photo: { url: "https://example.com/more.jpg", credit: "via NY Post" },
      }),
    ],
  };

  const text = checkInTimeZone(EASTERN, () => readText(renderNews([card], ALL_ON, NOW)));

  assert.equal(
    text,
    "Liberty The lead ESPN | Today What happened. Read on ESPN " +
      "More on this There's one key element NY Post | Yesterday",
  );
  assert.equal(renderNews([card], ALL_ON, NOW).text.match(/<img/g), null);
});

test("a photo's credit sits beside its teams, and a card without one shows only the teams", () => {
  const photo = { url: "https://example.com/photo.jpg", credit: "AP" };
  const readTop = (story) =>
    renderNews(createCards([story]), ALL_ON, NOW).text.match(
      /<div class="news-top">[\s\S]*?<\/div>/,
    )?.[0];
  const withoutCredit = createStory({ photo: { ...photo, credit: "" } });

  const top = readTop(createStory({ photo }));
  assert.match(top, /class="news-teams"[\s\S]*Liberty[\s\S]*class="news-photo-credit">Photo: AP</);
  assert.equal(readTop(withoutCredit), undefined);
  assert.match(renderNews(createCards([withoutCredit]), ALL_ON, NOW).text, /class="news-teams"/);
});

test("a photo's credit splits before the agency it came through, one without an agency stays whole, and each can wrap after a slash", () => {
  const readCredit = (credit) =>
    renderNews(
      createCards([createStory({ photo: { url: "https://example.com/photo.jpg", credit } })]),
      ALL_ON,
      NOW,
    ).text.match(/<p class="news-photo-credit">([\s\S]*?)<\/p>/)?.[1];

  assert.match(
    readCredit("Sarah Stier/NBAE via Getty Images"),
    /^<span class="credit-part">Photo: Sarah Stier\/<wbr \/>NBAE<\/span>\s+<span class="credit-part">via Getty Images<\/span>$/,
  );
  assert.match(
    readCredit("via Getty Images"),
    /^<span class="credit-part">Photo<\/span>\s+<span class="credit-part">via Getty Images<\/span>$/,
  );
  assert.equal(readCredit("Brett Davis/Imagn Images"), "Photo: Brett Davis/<wbr />Imagn Images");
  assert.equal(
    readCredit("AP Photo/Frank Franklin II/File"),
    "Photo: AP Photo/<wbr />Frank Franklin II/<wbr />File",
  );
});

test("a story this device has opened shows a check in place of its arrow, and the others keep theirs", () => {
  const stories = [
    createStory({ id: "opened", publishedAt: "2026-10-05T12:00:00.000Z" }),
    createStory({ id: "unread", outlet: "The IX", source: "ix" }),
  ];
  const opened = { "https://example.com/opened": NOW };

  const buttons =
    renderNews(createCards(stories), ALL_ON, NOW, { opened }).text.match(
      /<a\s+class="read-button[\s\S]*?<\/a\s*>/g,
    ) ?? [];

  assert.equal(buttons.length, 2);
  assert.match(buttons[0], /class="read-button opened"[\s\S]*class="read-check"/);
  assert.doesNotMatch(buttons[0], /read-arrow/);
  assert.match(buttons[1], /class="read-button"[\s\S]*class="read-arrow"/);
  assert.doesNotMatch(buttons[1], /read-check/);
});

test("a story's day is today, yesterday, its weekday within the week, and its date before that", () => {
  const readDay = (publishedAt) =>
    checkInTimeZone(
      EASTERN,
      () =>
        readText(renderNews(createCards([createStory({ publishedAt })]), ALL_ON, NOW)).match(
          /ESPN \| (\S+( \d+)?)/,
        )?.[1],
    );

  assert.equal(readDay("2026-10-05T05:00:00.000Z"), "Today");
  assert.equal(readDay("2026-10-05T03:00:00.000Z"), "Yesterday");
  assert.equal(readDay("2026-10-01T15:00:00.000Z"), "Thu");
  assert.equal(readDay("2026-09-27T15:00:00.000Z"), "Sep 27");
});

test("a story's links open apart from the page, and neither they nor its photo tell the outlet the page's address", () => {
  const story = createStory({ photo: { url: "https://example.com/photo.jpg", credit: "AP" } });
  const markup = renderNews(createCards([story]), ALL_ON, NOW).text;
  const links = markup.match(/<a\s[^>]*>/g) ?? [];
  const photos = markup.match(/<img\s[^>]*>/g) ?? [];

  assert.equal(links.length, 2);
  for (const link of links) assert.match(link, /target="_blank"\s+rel="noopener noreferrer"/);
  assert.equal(photos.length, 1);
  assert.match(photos[0], /referrerpolicy="no-referrer"/);
});

test("with no news, or none from the outlets this device reads, the view says so", () => {
  const athleticOnly = [createStory({ source: "athletic" })];

  assert.equal(readText(renderNews([], ALL_ON, NOW)), "No news yet");
  assert.equal(
    readText(renderNews(createCards(athleticOnly), { teamOutlets: true, paywalled: false }, NOW)),
    "No news yet",
  );
});

test("in two columns, each card goes to the shorter one, so a short card sits under a short one", () => {
  const photo = { url: "https://example.com/photo.jpg", credit: "AP" };
  const stories = [
    createStory({ id: "tall", title: "Tall", photo, publishedAt: "2026-10-04T15:00:00.000Z" }),
    createStory({ id: "short", title: "Short", publishedAt: "2026-10-04T14:00:00.000Z" }),
    createStory({ id: "older", title: "Older", publishedAt: "2026-10-03T12:00:00.000Z" }),
  ];
  const readColumns = (columnCount) =>
    (
      renderNews(createCards(stories), ALL_ON, NOW, { columnCount }).text.match(
        /<ul class="news-column">[\s\S]*?<\/ul>/g,
      ) ?? []
    ).map((column) =>
      [...column.matchAll(/<h3[^>]*>\s*<a[^>]*>([^<]*)</g)].map((match) => match[1]),
    );

  assert.deepEqual(readColumns(1), [["Tall", "Short", "Older"]]);
  assert.deepEqual(readColumns(2), [["Tall"], ["Short", "Older"]]);
});

test("each card is named by its lead, so a redraw keeps the card, and its photo, wherever it moves", () => {
  const stories = [
    createStory({ id: "older", publishedAt: "2026-10-04T12:00:00.000Z" }),
    createStory({ id: "newer", publishedAt: "2026-10-05T12:00:00.000Z" }),
  ];
  const keys = [
    ...renderNews(createCards(stories), ALL_ON, NOW).text.matchAll(/<li data-key="([^"]*)"/g),
  ];

  assert.deepEqual(
    keys.map((match) => match[1]),
    ["newer", "older"],
  );
});

test("a card's photo draws in the frame the Worker sized for it, and 16:9 from its top until it has", () => {
  const url = "https://example.com/photo.jpg";
  const readPhotoStyle = (photo) =>
    renderNews(createCards([createStory({ photo })]), ALL_ON, NOW).text.match(
      /<img[^>]*class="news-photo"[^>]*style="([^"]*)"/,
    )?.[1];

  // Claude's frame starts 0.128 down a 2:3 photo, of the 0.555 a 3:2 frame can move down it.
  assert.equal(
    readPhotoStyle({ url, credit: "", width: 683, height: 1024, frameTop: 0.128 }),
    "--photo-aspect: 1.5; --photo-position: 23.049%",
  );
  assert.equal(
    readPhotoStyle({ url, credit: "", width: 1600, height: 1000 }),
    "--photo-aspect: 1.6; --photo-position: 50%",
  );
  assert.equal(readPhotoStyle({ url, credit: "" }), "--photo-aspect: 1.778; --photo-position: 0%");
});

test("in two columns, a card whose photo's frame is taller counts as taller", () => {
  const url = "https://example.com/photo.jpg";
  const readColumns = (photo) => {
    const cards = [
      { lead: createStory({ id: "photo", title: "Photo", photo }), more: [] },
      {
        lead: createStory({ id: "more", title: "More", publishedAt: "2026-10-04T11:00:00.000Z" }),
        more: [
          createStory({ id: "under", title: "Under", publishedAt: "2026-10-04T10:00:00.000Z" }),
        ],
      },
      ...["Third", "Fourth"].map((title, index) => ({
        lead: createStory({ id: title, title, publishedAt: `2026-10-04T0${8 - index}:00:00.000Z` }),
        more: [],
      })),
    ];
    return renderNews(cards, ALL_ON, NOW, { columnCount: 2 })
      .text.split('<ul class="news-column">')
      .slice(1)
      .map((column) =>
        [...column.matchAll(/<h3[^>]*>\s*<a[^>]*>([^<]*)</g)].map((match) => match[1]),
      );
  };

  assert.deepEqual(readColumns({ url, credit: "" }), [
    ["Photo", "Fourth"],
    ["More", "Third"],
  ]);
  assert.deepEqual(readColumns({ url, credit: "", width: 683, height: 1024 }), [
    ["Photo"],
    ["More", "Third", "Fourth"],
  ]);
});
