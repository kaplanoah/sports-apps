import { test, expect, openApp, openSettings, ON_A_PHONE } from "./harness.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listTextOffRoles } from "../../../../tests/browser/type-roles.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { listTapsOffButtons } from "../../../../tests/browser/tap-states.mjs";
import { countTextLines } from "../../../../tests/browser/text-lines.mjs";
import { SETTINGS } from "../../../../tests/browser/settings.mjs";

test.use({ ...ON_A_PHONE, contextOptions: { reducedMotion: "reduce" } });

/**
 * @param {string} photoUrl
 * @param {Record<string, any>} fields
 */
const createStory = (photoUrl, fields) => ({
  url: `https://example.com/${fields.id}`,
  summary: "What happened, in a sentence.",
  author: "A Writer",
  publishedAt: "2026-09-24T14:00:00.000Z",
  photo: { url: photoUrl, credit: "Getty Images" },
  teams: ["NYM"],
  ...fields,
});

/**
 * The Athletic's story with ESPN's under it, and one only the Mets' own outlets carry.
 * @param {string} photoUrl
 */
const createCards = (photoUrl) => [
  {
    lead: createStory(photoUrl, {
      id: "athletic",
      title: "MLB proposes a 154-game season",
      outlet: "The Athletic",
      source: "athletic",
      teams: [],
    }),
    more: [
      createStory(photoUrl, {
        id: "espn",
        title: "MLB proposes shorter season, best-of-7 division series",
        outlet: "ESPN",
        source: "espn",
        teams: [],
      }),
    ],
  },
  {
    lead: createStory(photoUrl, {
      id: "post",
      title: "Mets fire hitting coach in staff shake-up",
      outlet: "NY Post",
      source: "nypost",
      teamFeed: "NYM",
      publishedAt: "2026-09-24T15:00:00.000Z",
    }),
    more: [],
  },
];

/** @param {import("@playwright/test").Page} page */
async function openNews(page) {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "News" }).click();
  await expect(page.locator("#newsList")).toHaveText("No news yet");
  await app.writeFromWorker("news/cards", {
    cards: createCards(new URL("icon-180.png", page.url()).href),
  });
  await expect(page.locator(".news-card")).toHaveCount(2);
  return app;
}

/** @param {import("@playwright/test").Page} page */
const readHeadlines = (page) => page.locator(".news-card h3").allTextContents();

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
async function switchOff(page, name) {
  await openSettings(page);
  const toggle = page.getByRole("switch", { name });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(page.locator(SETTINGS)).toBeHidden();
}

test("the News tab shows a card for each piece of news the Worker saves, newest first, with the stories under its lead", async ({
  page,
}) => {
  await openNews(page);

  expect(await readHeadlines(page)).toEqual([
    "Mets fire hitting coach in staff shake-up",
    "MLB proposes a 154-game season",
  ]);
  const mets = page.locator(".news-card").first();
  await expect(mets.locator(".news-teams")).toHaveText("Mets");
  await expect(mets.getByRole("link", { name: /^Read on NY Post/ })).toHaveAttribute(
    "href",
    "https://example.com/post",
  );
  await expect(page.locator(".news-more-title")).toHaveText([
    "MLB proposes shorter season, best-of-7 division series",
  ]);
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  expect(await listTapsOffButtons(page)).toEqual([]);
});

test("switching off the Mets' own outlets or The Athletic leaves their stories out, and ESPN's leads in The Athletic's place", async ({
  page,
}) => {
  await openNews(page);

  await switchOff(page, "Include dedicated Mets sources");
  expect(await readHeadlines(page)).toEqual(["MLB proposes a 154-game season"]);
  await switchOff(page, "Include content from The Athletic");
  expect(await readHeadlines(page)).toEqual([
    "MLB proposes shorter season, best-of-7 division series",
  ]);
  await expect(page.locator(".news-more")).toHaveCount(0);

  await openSettings(page);
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
});

test("after a reload, the news the page last showed answers the News switches while the store is still answering", async ({
  page,
}) => {
  const app = await openNews(page);
  const release = await app.holdStore();

  await page.reload();
  expect(await readHeadlines(page)).toEqual([
    "Mets fire hitting coach in staff shake-up",
    "MLB proposes a 154-game season",
  ]);
  await switchOff(page, "Include dedicated Mets sources");

  expect(await readHeadlines(page)).toEqual(["MLB proposes a 154-game season"]);
  release();
});

test("switching off Baseball Prospectus leaves its stories out, and the choice stays after a reload", async ({
  page,
}) => {
  const app = await openNews(page);
  const photoUrl = new URL("icon-180.png", page.url()).href;
  const prospectus = createStory(photoUrl, {
    id: "prospectus",
    title: "That lucky fourth run",
    outlet: "Baseball Prospectus",
    source: "bbprospectus",
    teams: [],
  });
  await app.writeFromWorker("news/cards", {
    cards: [...createCards(photoUrl), { lead: prospectus, more: [] }],
  });
  await expect(page.locator(".news-card")).toHaveCount(3);

  await switchOff(page, "Include content from Baseball Prospectus");

  expect(await readHeadlines(page)).toEqual([
    "Mets fire hitting coach in staff shake-up",
    "MLB proposes a 154-game season",
  ]);
  await page.reload();
  await expect(page.locator(".news-card")).toHaveCount(2);
  await openSettings(page);
  await expect(
    page.getByRole("switch", { name: "Include content from Baseball Prospectus" }),
  ).toHaveAttribute("aria-checked", "false");
});

test("a photo's credit too long to split before its agency wraps as one text, in two lines beside two clubs", async ({
  page,
}) => {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "News" }).click();
  await expect(page.locator("#newsList")).toHaveText("No news yet");
  const photoUrl = new URL("icon-180.png", page.url()).href;
  const lead = createStory(photoUrl, {
    id: "alcs",
    title: "Guardians' Williams, White Sox's Burke to start for ALCS bid",
    outlet: "ESPN",
    source: "espn",
    teams: ["CLE", "CWS"],
    photo: {
      url: photoUrl,
      credit: "Frank Jansky/Icon Sportswire/Zuma via Getty Images",
    },
  });
  await app.writeFromWorker("news/cards", { cards: [{ lead, more: [] }] });
  const credit = page.locator(".news-photo-credit");

  await expect(credit).toHaveClass(/credit-flow/);
  expect(await countTextLines(credit)).toEqual([2]);
});
