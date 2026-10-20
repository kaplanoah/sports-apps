import { test, expect, openApp } from "./harness.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listTextOffRoles } from "../../../../tests/browser/type-roles.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { keepInOtherTab } from "../../../../tests/browser/other-tab.mjs";
import { countTextLines } from "../../../../tests/browser/text-lines.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

/**
 * @param {string} photoUrl
 * @param {Record<string, any>} fields
 */
const createStory = (photoUrl, fields) => ({
  url: `https://example.com/${fields.id}`,
  summary: "What happened, in a sentence.",
  author: "A Writer",
  publishedAt: "2026-09-30T14:00:00.000Z",
  photo: { url: photoUrl, credit: "Getty Images" },
  teams: ["NYL", "ATL"],
  ...fields,
});

/**
 * A card for each story, with nothing under its lead.
 * @param {any[]} stories
 */
const createCards = (stories) => stories.map((lead) => ({ lead, more: [] }));

/**
 * Three stories: The Athletic's, ESPN's, and one only the Liberty's own outlets carry, newest.
 * @param {string} photoUrl
 */
const createStories = (photoUrl) => [
  createStory(photoUrl, {
    id: "athletic",
    title: "The Liberty's defense held the Dream to 30 percent",
    outlet: "The Athletic",
    source: "athletic",
  }),
  createStory(photoUrl, {
    id: "espn",
    title: "Film review: how the Dream changed their approach",
    outlet: "ESPN",
    source: "espn",
    publishedAt: "2026-09-30T13:30:00.000Z",
  }),
  createStory(photoUrl, {
    id: "post",
    title: "Stewart sat out practice with a sore knee",
    outlet: "NY Post",
    source: "nypost",
    teamFeed: "NYL",
    publishedAt: "2026-09-30T15:00:00.000Z",
  }),
];

/**
 * @param {import("@playwright/test").Page} page
 * @param {(photoUrl: string) => any[]} buildCards
 */
async function openNewsWithCards(page, buildCards) {
  const app = await openApp(page);
  await page.getByRole("tab", { name: "News" }).click();
  await expect(page.locator("#newsList")).toHaveText("No news yet");
  const cards = buildCards(new URL("icon-180.png", page.url()).href);
  await app.writeDocument("news/cards", { cards });
  await expect(page.locator(".news-card")).toHaveCount(cards.length);
  return app;
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {(photoUrl: string) => any[]} [buildStories]
 */
const openNewsWithStories = (page, buildStories = createStories) =>
  openNewsWithCards(page, (photoUrl) => createCards(buildStories(photoUrl)));

/**
 * A short card without a photo, a taller one, and an older one that goes under the short one.
 * @param {string} photoUrl
 */
const createThreeStories = (photoUrl) => {
  const [athletic, , post] = createStories(photoUrl);
  const award = createStory(photoUrl, {
    id: "award",
    title: "Collier named Defensive Player of the Year",
    outlet: "ESPN",
    source: "espn",
    publishedAt: "2026-09-30T13:00:00.000Z",
  });
  return [{ ...post, photo: null }, athletic, award];
};

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} title
 */
const findCardBox = (page, title) =>
  page.locator(".news-card").filter({ hasText: title }).boundingBox();

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
async function switchOff(page, name) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const toggle = page.getByRole("switch", { name });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(page.locator("#settingsDialog")).toBeHidden();
}

const readHeadlines = (page) => page.locator(".news-card h3").allTextContents();

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} title
 */
const findCard = (page, title) => page.locator(".news-card").filter({ hasText: title });

test("the News tab shows a card for each story the Worker saves", async ({ page }) => {
  await openNewsWithStories(page);

  expect((await readHeadlines(page)).toSorted()).toEqual([
    "Film review: how the Dream changed their approach",
    "Stewart sat out practice with a sore knee",
    "The Liberty's defense held the Dream to 30 percent",
  ]);
  const athletic = findCard(page, "The Liberty's defense");
  await expect(athletic.locator(".news-teams")).toHaveText("LibertyDream");
  await expect(
    findCard(page, "Film review").getByRole("link", { name: /^Read on ESPN/ }),
  ).toHaveAttribute("href", "https://example.com/espn");
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
});

test("switching off The Athletic or the Liberty's own outlets leaves their stories out, and the choice stays", async ({
  page,
}) => {
  await openNewsWithStories(page);

  await switchOff(page, "Include content from The Athletic");
  expect(await readHeadlines(page)).toEqual([
    "Stewart sat out practice with a sore knee",
    "Film review: how the Dream changed their approach",
  ]);

  await switchOff(page, "Include dedicated Liberty sources");
  expect(await readHeadlines(page)).toEqual(["Film review: how the Dream changed their approach"]);

  await page.reload();
  await expect(page.locator(".news-card h3")).toHaveText([
    "Film review: how the Dream changed their approach",
  ]);
});

test("switching off The Athletic in another tab leaves its stories out of this one", async ({
  page,
}) => {
  await openNewsWithStories(page);

  await keepInOtherTab(page, "newsChoices", { teamOutlets: true, paywalled: false });

  await expect(page.locator(".news-card h3")).toHaveText([
    "Stewart sat out practice with a sore knee",
    "Film review: how the Dream changed their approach",
  ]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Include content from The Athletic" }),
  ).toHaveAttribute("aria-checked", "false");
});

test("a card's photo runs its full width", async ({ page }) => {
  await openNewsWithStories(page);
  const card = page.locator(".news-card").first();

  const cardBox = await card.boundingBox();
  const photoBox = await card.locator(".news-photo").boundingBox();
  expect(Math.abs(photoBox.width - (cardBox.width - 2))).toBeLessThan(1);
});

test("a photo that doesn't load leaves its card with its credit, and the others keep theirs", async ({
  page,
}) => {
  await page.route("https://photos.example/**", (route) => route.fulfill({ status: 404 }));
  await openNewsWithStories(page, (photoUrl) => {
    const [athletic, espn, post] = createStories(photoUrl);
    const moved = { ...post.photo, url: "https://photos.example/moved.jpg" };
    return [{ ...post, photo: moved }, athletic, espn];
  });

  const post = findCard(page, "Stewart sat out practice");
  await expect(post.locator("img")).toHaveCount(0);
  await expect(post.locator(".news-photo-credit")).toHaveCount(0);
  await expect(page.locator(".news-photo")).toHaveCount(2);
});

test("a photo's frame takes the shape the Worker read, from 16:9 to 3:2, whatever the photo's own", async ({
  page,
}) => {
  await openNewsWithStories(page, (photoUrl) => {
    const [athletic, espn, post] = createStories(photoUrl);
    return [
      { ...post, photo: { ...post.photo, width: 683, height: 1024, frameTop: 0.128 } },
      { ...athletic, photo: { ...athletic.photo, width: 1600, height: 1000 } },
      espn,
    ];
  });

  const frames = await page.locator(".news-photo").evaluateAll((photos) =>
    photos.map((photo) => ({
      shape: Math.round((photo.clientWidth / photo.clientHeight) * 100) / 100,
      position: getComputedStyle(photo).objectPosition,
    })),
  );
  expect(frames).toEqual([
    { shape: 1.5, position: "50% 23.049%" },
    { shape: 1.6, position: "50% 50%" },
    { shape: 1.78, position: "50% 0%" },
  ]);
});

test("under its lead, a card lists the stories that add to it, quieter than the lead and with no photo", async ({
  page,
}) => {
  await openNewsWithCards(page, (photoUrl) => {
    const [athletic, espn, post] = createStories(photoUrl);
    return [{ lead: athletic, more: [espn, post] }];
  });
  const more = page.locator(".news-more");

  await expect(more.locator(".news-more-label")).toHaveText("More on this");
  await expect(more.locator(".news-more-title")).toHaveText([
    "Film review: how the Dream changed their approach",
    "Stewart sat out practice with a sore knee",
  ]);
  await expect(more.locator("img")).toHaveCount(0);
  const readSize = (locator) =>
    locator.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(await readSize(more.locator(".news-more-title").first())).toBeLessThan(
    await readSize(page.locator("h3.news-title")),
  );
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
});

/**
 * The first card's summary and author line, and the theme's ink and mid ink, each as red, green,
 * and blue.
 * @param {import("@playwright/test").Page} page
 */
const readCardInks = (page) =>
  page
    .locator(".news-card")
    .first()
    .evaluate((card) => {
      const context = /** @type {CanvasRenderingContext2D} */ (
        document.createElement("canvas").getContext("2d")
      );
      const readChannels = (/** @type {Element} */ element) => {
        context.fillStyle = getComputedStyle(element).color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      };
      const readToken = (/** @type {string} */ name) => {
        const probe = card.appendChild(document.createElement("span"));
        probe.style.color = `var(${name})`;
        const channels = readChannels(probe);
        probe.remove();
        return channels;
      };
      return {
        summary: readChannels(/** @type {Element} */ (card.querySelector(".news-summary"))),
        authorLine: readChannels(/** @type {Element} */ (card.querySelector(".news-meta"))),
        ink: readToken("--ink"),
        midInk: readToken("--ink-mid"),
      };
    });

for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
  test(`a card's author line reads in mid ink, and its summary a step darker, short of the headline's ink, in ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openNewsWithStories(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);

    const { summary, authorLine, ink, midInk } = await readCardInks(page);
    expect(authorLine).toEqual(midInk);
    expect(measureColorDistance(summary, ink)).toBeGreaterThan(0);
    expect(measureColorDistance(summary, ink)).toBeLessThan(measureColorDistance(midInk, ink));
  });
}

/**
 * The three stories, with each story's photo its own.
 * @param {string} photoUrl
 */
const createStoriesWithOwnPhotos = (photoUrl) =>
  createStories(photoUrl).map((/** @type {any} */ story) => ({
    ...story,
    photo: { ...story.photo, url: `${photoUrl}?${story.id}` },
  }));

/**
 * A story newer than the others.
 * @param {string} photoUrl
 */
const createTradeStory = (photoUrl) =>
  createStory(`${photoUrl}?trade`, {
    id: "trade",
    title: "The Sky traded for a guard before the draft",
    outlet: "ESPN",
    source: "espn",
    publishedAt: "2026-09-30T16:00:00.000Z",
  });

// Each photo the page shows is marked with the address it showed, which a new element lacks.
const markShownPhotos = (page) =>
  page.evaluate(() => {
    for (const photo of document.querySelectorAll(".news-photo"))
      Object.assign(photo, { shownAt: /** @type {HTMLImageElement} */ (photo).src });
  });

// A wide screen's two columns list their photos column by column, so they're read in order of
// their addresses.
const readShownPhotos = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".news-photo")]
      .map((photo) => ({
        shownAt: /** @type {any} */ (photo).shownAt ?? null,
        src: /** @type {HTMLImageElement} */ (photo).src,
      }))
      .sort((first, second) => first.src.localeCompare(second.src)),
  );

test("a story that arrives above the others gets a card of its own, and each card under it keeps its photo", async ({
  page,
}) => {
  const app = await openNewsWithStories(page, createStoriesWithOwnPhotos);
  const photoUrl = new URL("icon-180.png", page.url()).href;
  await markShownPhotos(page);

  await app.writeDocument("news/cards", {
    cards: createCards([createTradeStory(photoUrl), ...createStoriesWithOwnPhotos(photoUrl)]),
  });

  await expect(page.locator(".news-card")).toHaveCount(4);
  expect(await readShownPhotos(page)).toEqual([
    { shownAt: `${photoUrl}?athletic`, src: `${photoUrl}?athletic` },
    { shownAt: `${photoUrl}?espn`, src: `${photoUrl}?espn` },
    { shownAt: `${photoUrl}?post`, src: `${photoUrl}?post` },
    { shownAt: null, src: `${photoUrl}?trade` },
  ]);
});

test("a story that moves to the top keeps its card and photo", async ({ page }) => {
  const app = await openNewsWithStories(page, createStoriesWithOwnPhotos);
  const photoUrl = new URL("icon-180.png", page.url()).href;
  await markShownPhotos(page);
  const [athletic, ...others] = createStoriesWithOwnPhotos(photoUrl);

  await app.writeDocument("news/cards", {
    cards: createCards([{ ...athletic, publishedAt: "2026-09-30T16:00:00.000Z" }, ...others]),
  });

  await expect(page.locator(".news-card h3").first()).toHaveText(
    "The Liberty's defense held the Dream to 30 percent",
  );
  expect(await readShownPhotos(page)).toEqual([
    { shownAt: `${photoUrl}?athletic`, src: `${photoUrl}?athletic` },
    { shownAt: `${photoUrl}?espn`, src: `${photoUrl}?espn` },
    { shownAt: `${photoUrl}?post`, src: `${photoUrl}?post` },
  ]);
});

test("a page leaving the screen has its service worker keep the photos from other sites it showed", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const sent = [];
    Object.assign(window, { sentToWorker: sent });
    Object.defineProperty(navigator.serviceWorker, "controller", {
      get: () => ({ postMessage: (message) => sent.push(message) }),
    });
  });
  const app = await openApp(page);
  const photo = await page.request.get("icon-180.png");
  const photoBody = await photo.body();
  await page.route("https://photos.example/**", (route) =>
    route.fulfill({ body: photoBody, contentType: "image/png" }),
  );
  await page.getByRole("tab", { name: "News" }).click();
  await app.writeDocument("news/cards", {
    cards: createCards(createStoriesWithOwnPhotos("https://photos.example/photo.png")),
  });
  await expect(page.locator(".news-photo")).toHaveCount(3);
  await expect
    .poll(() =>
      page
        .locator("#newsList img")
        .evaluateAll((images) =>
          images.every((image) => /** @type {HTMLImageElement} */ (image).naturalWidth > 0),
        ),
    )
    .toBe(true);

  await page.evaluate(() => dispatchEvent(new Event("pagehide")));

  const sent = await page.evaluate(() => /** @type {any} */ (window).sentToWorker);
  expect(sent.at(-1)).toEqual({
    type: "keepImages",
    urls: [
      "https://photos.example/photo.png?post",
      "https://photos.example/photo.png?espn",
      "https://photos.example/photo.png?athletic",
    ],
  });
});

test("a story's Read button looks the same after it's opened, and after a reload", async ({
  page,
}) => {
  await page.context().route("https://example.com/**", (route) => route.fulfill({ body: "" }));
  await openNewsWithStories(page);
  const espn = page.getByRole("link", { name: /^Read on ESPN/ });
  const before = await espn.evaluate((button) => button.outerHTML);

  const popup = page.waitForEvent("popup");
  await espn.click();
  await (await popup).close();

  await expect(espn.locator(".read-arrow")).toBeVisible();
  expect(await espn.evaluate((button) => button.outerHTML)).toBe(before);

  await page.reload();
  await expect(espn.locator(".read-arrow")).toBeVisible();
  expect(await espn.evaluate((button) => button.outerHTML)).toBe(before);
});

/**
 * How far apart two colors are, summed over their red, green, and blue.
 * @param {number[]} first
 * @param {number[]} second
 */
const measureColorDistance = (first, second) =>
  first.reduce((sum, channel, index) => sum + Math.abs(channel - second[index]), 0);

/**
 * A link's text color once any change to it has finished, and the theme's orange, each as red,
 * green, and blue, the edge drawn around it, and whether it's underlined.
 * @param {import("@playwright/test").Locator} link
 */
async function readSettledStyle(link) {
  await expect.poll(() => link.evaluate((element) => element.getAnimations().length)).toBe(0);
  return link.evaluate((element) => {
    const context = /** @type {CanvasRenderingContext2D} */ (
      document.createElement("canvas").getContext("2d")
    );
    const readChannels = (color) => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const style = getComputedStyle(element);
    return {
      color: readChannels(style.color),
      edge: `${style.borderTopWidth} ${style.borderTopStyle} ${style.boxShadow}`,
      underline: style.textDecorationLine,
      orange: readChannels(getComputedStyle(document.documentElement).getPropertyValue("--orange")),
    };
  });
}

for (const colorScheme of /** @type {const} */ (["light", "dark"])) {
  test(`under the mouse, a headline and a Read button turn plainly toward orange, with no underline or new border, as a team's name does, in ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openNewsWithStories(page);
    const athletic = findCard(page, "The Liberty's defense");
    const headline = athletic.locator("h3.news-title a");
    const button = athletic.getByRole("link", { name: /^Read on The Athletic/ });
    const headlineAtRest = await readSettledStyle(headline);
    const buttonAtRest = await readSettledStyle(button);

    await headline.hover();
    const headlineHovered = await readSettledStyle(headline);
    await button.hover();
    const buttonHovered = await readSettledStyle(button);
    const teamName = athletic.locator(".news-teams .team-name").first();
    await teamName.hover();
    const teamNameHovered = await readSettledStyle(teamName);

    for (const [atRest, hovered] of [
      [headlineAtRest, headlineHovered],
      [buttonAtRest, buttonHovered],
    ]) {
      expect(measureColorDistance(hovered.color, atRest.color)).toBeGreaterThan(60);
      expect(measureColorDistance(hovered.color, atRest.orange)).toBeLessThan(
        measureColorDistance(atRest.color, atRest.orange),
      );
      expect(hovered.underline).toBe("none");
    }
    expect(buttonHovered.edge).toEqual(buttonAtRest.edge);
    expect(teamNameHovered.color).toEqual(headlineHovered.color);
  });
}

test("on a wide screen, each of two columns stacks its own cards, as far apart as the page's sides", async ({
  page,
}) => {
  await openNewsWithStories(page, createThreeStories);

  const practice = await findCardBox(page, "Stewart sat out practice");
  const defense = await findCardBox(page, "The Liberty's defense");
  const award = await findCardBox(page, "Collier named");
  const pageSide = await page.locator("#newsList").boundingBox();
  expect(defense.x - (practice.x + practice.width)).toBeCloseTo(16, 0);
  expect(Math.abs(award.x - practice.x)).toBeLessThan(1);
  expect(award.y - (practice.y + practice.height)).toBeCloseTo(16, 0);
  expect(award.y).toBeLessThan(defense.y + defense.height);
  expect(Math.abs(practice.x - pageSide.x)).toBeLessThan(1);
});

test.describe("on a phone, the news", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("lists one card under another, newest first, as far apart as the page's sides", async ({
    page,
  }) => {
    await openNewsWithStories(page, createThreeStories);

    expect(await readHeadlines(page)).toEqual([
      "Stewart sat out practice with a sore knee",
      "The Liberty's defense held the Dream to 30 percent",
      "Collier named Defensive Player of the Year",
    ]);
    const practice = await findCardBox(page, "Stewart sat out practice");
    const defense = await findCardBox(page, "The Liberty's defense");
    const sideMargin = 390 - (practice.x + practice.width);
    expect(sideMargin).toBeCloseTo(16, 0);
    expect(defense.y - (practice.y + practice.height)).toBeCloseTo(sideMargin, 0);
  });

  test("puts a card's teams as far under its photo as in from its side, beside the photo's credit, wrapping before they reach it", async ({
    page,
  }) => {
    await openNewsWithStories(page, (photoUrl) => [
      createStory(photoUrl, {
        id: "credit",
        title: "The Liberty and the Dream meet again in the semifinals",
        outlet: "ESPN",
        source: "espn",
        photo: { url: photoUrl, credit: "Andy Lyons/Getty Images North America via AFP" },
      }),
    ]);
    const card = await page.locator(".news-card").boundingBox();
    const photo = await page.locator(".news-photo").boundingBox();
    const credit = await page.locator(".news-photo-credit").boundingBox();
    const [liberty, dream] = await Promise.all(
      [0, 1].map((index) => page.locator(".news-teams .club").nth(index).boundingBox()),
    );
    const libertyDot = await page.locator(".news-teams .dot").first().boundingBox();
    const cardBorder = 1;

    expect(libertyDot.y - (photo.y + photo.height)).toBeCloseTo(16, 0);
    expect(libertyDot.x - (card.x + cardBorder)).toBeCloseTo(16, 0);
    expect(credit.y - (photo.y + photo.height)).toBeCloseTo(5, 0);
    expect(card.x + card.width - cardBorder - (credit.x + credit.width)).toBeCloseTo(8, 0);
    expect(dream.y - (liberty.y + liberty.height)).toBeCloseTo(5, 0);
    expect(Math.max(liberty.x + liberty.width, dream.x + dream.width)).toBeLessThan(credit.x);
    const clippedNames = await page
      .locator(".news-teams .team-name")
      .evaluateAll((names) => names.filter((name) => name.scrollWidth > name.clientWidth).length);
    expect(clippedNames).toBe(0);
  });

  test("wraps a photo's credit before the agency it came through, keeping each part on a line", async ({
    page,
  }) => {
    await openNewsWithStories(page, (photoUrl) => [
      createStory(photoUrl, {
        id: "credit",
        title: "The Liberty and the Dream meet again in the semifinals",
        outlet: "ESPN",
        source: "espn",
        photo: { url: photoUrl, credit: "Christian Petersen/NBAE via Getty Images" },
      }),
    ]);
    const credit = page.locator(".news-photo-credit");
    const [taker, agency] = await Promise.all(
      [0, 1].map((index) => credit.locator(".credit-part").nth(index).boundingBox()),
    );

    await expect(credit).toHaveText("Photo: Christian Petersen/NBAE via Getty Images");
    await expect(credit.locator(".credit-part").last()).toHaveText("via Getty Images");
    expect(agency.y).toBeCloseTo(taker.y + taker.height, 0);
    expect(agency.height).toBeCloseTo(taker.height, 0);
  });

  test("wraps a photo's credit as one text where a part wouldn't fit on a line of its own, and splits it again once the screen widens", async ({
    page,
  }) => {
    // Chromium reports its fonts loaded again on a resize, which would fit the credits on its own.
    await page.addInitScript(() =>
      document.fonts.addEventListener("loadingdone", (event) => {
        if ("ignoresFontLoads" in window) event.stopImmediatePropagation();
      }),
    );
    await openNewsWithStories(page, (photoUrl) => [
      createStory(photoUrl, {
        id: "credit",
        title: "The Liberty and the Dream meet again in the semifinals",
        outlet: "ESPN",
        source: "espn",
        photo: { url: photoUrl, credit: "Andy Lyons/Getty Images North America via AFP" },
      }),
    ]);
    const credit = page.locator(".news-photo-credit");
    await page.evaluate(() => document.fonts.ready);

    await expect(credit).toHaveClass(/credit-flow/);
    expect(await countTextLines(credit)).toEqual([2]);

    await page.evaluate(() => Object.assign(window, { ignoresFontLoads: true }));
    await page.setViewportSize({ width: 600, height: 844 });
    await expect(credit).not.toHaveClass(/credit-flow/);
    expect(await countTextLines(credit.locator(".credit-part"))).toEqual([1, 1]);
  });

  test("keeps each card's photo when a story arrives above it", async ({ page }) => {
    const app = await openNewsWithStories(page, createStoriesWithOwnPhotos);
    const photoUrl = new URL("icon-180.png", page.url()).href;
    await markShownPhotos(page);

    await app.writeDocument("news/cards", {
      cards: createCards([createTradeStory(photoUrl), ...createStoriesWithOwnPhotos(photoUrl)]),
    });

    await expect(page.locator(".news-card")).toHaveCount(4);
    expect(await readShownPhotos(page)).toEqual([
      { shownAt: `${photoUrl}?athletic`, src: `${photoUrl}?athletic` },
      { shownAt: `${photoUrl}?espn`, src: `${photoUrl}?espn` },
      { shownAt: `${photoUrl}?post`, src: `${photoUrl}?post` },
      { shownAt: null, src: `${photoUrl}?trade` },
    ]);
  });

  test("turns to two columns when the screen widens", async ({ page }) => {
    await openNewsWithStories(page, createThreeStories);
    await expect(page.locator(".news-column")).toHaveCount(1);

    await page.setViewportSize({ width: 1000, height: 844 });
    await expect(page.locator(".news-column")).toHaveCount(2);
  });
});

test.describe("with motion", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("a story that arrives above the others fades in its own card, and only it", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      /** @type {string[]} */
      const fadedHeadlines = [];
      Object.assign(window, { fadedHeadlines });
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (Array.isArray(frames) && frames[0]?.opacity === 0)
          fadedHeadlines.push(this.querySelector(".news-card h3")?.textContent ?? "");
        return animate.call(this, frames, options);
      };
    });
    const app = await openNewsWithStories(page, createStoriesWithOwnPhotos);
    const photoUrl = new URL("icon-180.png", page.url()).href;
    await page.evaluate(() => /** @type {any} */ (window).fadedHeadlines.splice(0));

    await app.writeDocument("news/cards", {
      cards: createCards([createTradeStory(photoUrl), ...createStoriesWithOwnPhotos(photoUrl)]),
    });

    await expect(page.locator(".news-card")).toHaveCount(4);
    expect(await page.evaluate(() => /** @type {any} */ (window).fadedHeadlines)).toEqual([
      "The Sky traded for a guard before the draft",
    ]);
  });
});
