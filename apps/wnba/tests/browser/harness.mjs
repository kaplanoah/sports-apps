import { readFileSync } from "node:fs";
import { buildSnapshot, REQUESTS } from "../../page/js/snapshot.js";
import { createBoxScoreServer, nameBoxScoreRequest } from "../../worker/src/box-score.js";
import { createHighlightsServer, describeHighlights } from "../../worker/src/highlights.js";
import {
  createLeadServer,
  nameScoreboardRequest,
  nameSummaryRequest,
} from "../../worker/src/lead.js";
import {
  PLAYOFFS,
  REGULAR_SEASON,
  createPlayerServer,
  nameGameLogRequest,
  nameTeamGameLogRequest,
  nameTotalsRequest,
} from "../../worker/src/player.js";
import { createPreviewServer, listUpcomingMeetings } from "../../worker/src/preview.js";
import { nameInjuriesRequest } from "../../worker/src/injuries.js";
import {
  createRosterServer,
  nameLeagueRosterRequest,
  namePlayerListRequest,
} from "../../worker/src/roster.js";
import { SeasonStore } from "../../worker/src/store.js";
import worker from "../../worker/src/index.js";
import {
  test,
  expect,
  createTestStore,
  createWorkerControls,
  connectToStore,
  loadPageAt,
  matchPath,
  serveLockedPage,
  LOCKED_PAGE_PATH,
} from "../../../../tests/browser/harness.mjs";
import { holdStore } from "../../../../tests/browser/hold-store.mjs";
import { joinGameLogs } from "../player-fixtures.js";

const AFTERNOON = JSON.parse(
  readFileSync(new URL("../fixtures/2026-09-30-afternoon.json", import.meta.url), "utf8"),
);
const NOW = AFTERNOON.now;
// Where ESPN says each of the afternoon's games was on.
const ESPN_SCOREBOARD = JSON.parse(
  readFileSync(new URL("../fixtures/2026-10-02-espn-scoreboard.json", import.meta.url), "utf8"),
);
const GAMES = JSON.parse(
  readFileSync(new URL("../fixtures/2026-10-01-games.json", import.meta.url), "utf8"),
);
const LEAD = JSON.parse(
  readFileSync(new URL("../fixtures/2026-10-01-espn-lead.json", import.meta.url), "utf8"),
);
// The league's rosters of the Liberty, Dream, Aces, Fever, and Wings this season and the Liberty's
// last, and its list of every player trimmed to theirs, as they were.
const ROSTERS = JSON.parse(
  readFileSync(new URL("../fixtures/2026-10-06-league-rosters.json", import.meta.url), "utf8"),
);
// ESPN's injury report, which says who is out and why.
const INJURIES = JSON.parse(
  readFileSync(new URL("../fixtures/2026-10-11-espn-injuries.json", import.meta.url), "utf8"),
);

const listRosterAnswers = () => [
  ...Object.entries(ROSTERS.rosters).map(([key, roster]) => {
    const [team, season] = key.split(":");
    return /** @type {[string, any]} */ ([nameLeagueRosterRequest(team, Number(season)), roster]);
  }),
  ...[2025, 2026].map(
    (season) => /** @type {[string, any]} */ ([namePlayerListRequest(season), ROSTERS.playerList]),
  ),
  /** @type {[string, any]} */ ([nameInjuriesRequest(), INJURIES.report]),
];

// The league's totals, team game logs, and the game logs of a few players, as a player's sheet
// reads them: the Liberty's Stewart, Fiebich, Sabally, Balogun, and Astier, the Aces' Wilson, and
// the Fever's Boston this season, and the Liberty's Ionescu last.
const PLAYERS = JSON.parse(
  readFileSync(new URL("../fixtures/2026-10-06-players.json", import.meta.url), "utf8"),
);

const listPlayerAnswers = () => [
  ...Object.keys(PLAYERS.totals).flatMap((season) =>
    [REGULAR_SEASON, PLAYOFFS].map(
      (seasonType) =>
        /** @type {[string, any]} */ ([
          nameGameLogRequest(Number(season), seasonType),
          joinGameLogs(PLAYERS.gameLogs, Number(season), seasonType),
        ]),
    ),
  ),
  ...Object.entries(PLAYERS.totals).map(
    ([season, totals]) =>
      /** @type {[string, any]} */ ([nameTotalsRequest(Number(season)), totals]),
  ),
  ...Object.entries(PLAYERS.teamGames).map(([key, games]) => {
    const [season, seasonType] = key.split(":");
    return /** @type {[string, any]} */ ([
      nameTeamGameLogRequest(Number(season), seasonType),
      games,
    ]);
  }),
  ...Object.entries(PLAYERS.gameLogs).map(([key, games]) => {
    const [id, season, seasonType] = key.split(":");
    return /** @type {[string, any]} */ ([
      nameGameLogRequest(Number(season), seasonType, id),
      games,
    ]);
  }),
];

export { test, expect, matchPath, GAMES, NOW, LOCKED_PAGE_PATH };

/**
 * A hex color as the browser's computed style writes it.
 * @param {string} hex
 */
export const formatRgb = (hex) =>
  `rgb(${[1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).join(", ")})`;

/**
 * The league's answers to the game sheet's routes, and to what the store reads ahead of them, from
 * the recorded box scores and schedule, with any box score changed, or the schedule refused. A game
 * without a box score is one that hasn't started. ESPN answers for the one game its lead was
 * recorded for, Valkyries at Wings, Game 2.
 * @param {{ boxScores?: Record<string, any>, isScheduleRefused?: boolean }} league
 */
function listLeagueAnswers({ boxScores = {}, isScheduleRefused = false }) {
  const answers = new Map([
    ...Object.entries({ ...GAMES.boxScores, ...boxScores }).map(
      ([id, box]) => /** @type {[string, any]} */ ([nameBoxScoreRequest(id), box]),
    ),
    [nameScoreboardRequest(LEAD.game.start), LEAD.scoreboard],
    [nameSummaryRequest(LEAD.eventId), LEAD.summary],
    ...listRosterAnswers(),
    ...listPlayerAnswers(),
  ]);
  if (!isScheduleRefused) answers.set(REQUESTS.schedule, GAMES.preview.schedule);
  return answers;
}

/**
 * The league as the game sheet's routes read it, refusing what it has no answer for.
 * @param {Parameters<typeof listLeagueAnswers>[0]} league
 */
function createLeagueFetch(league) {
  const answers = listLeagueAnswers(league);
  return async (/** @type {string} */ url) =>
    answers.has(url)
      ? new Response(JSON.stringify(answers.get(url)))
      : new Response("<Error>AccessDenied</Error>", { status: 403 });
}

/**
 * @param {import("@playwright/test").Route} route
 * @param {(url: URL) => Promise<Response>} serve
 */
async function answerFromWorker(route, serve) {
  const answer = await serve(new URL(route.request().url()));
  await route.fulfill({ status: answer.status, json: await answer.json() });
}

// Each test starts from the same snapshot, which takes far longer to build than to copy.
const afternoonSnapshots = new Map();

/** @param {number} season */
function readAfternoonSnapshot(season) {
  if (!afternoonSnapshots.has(season))
    afternoonSnapshots.set(
      season,
      buildSnapshot(
        {
          ...AFTERNOON.responses,
          networks: Object.values(ESPN_SCOREBOARD.answers),
        },
        { season, now: Date.parse(NOW) },
      ),
    );
  return structuredClone(afternoonSnapshots.get(season));
}

/**
 * The league as the store's jobs read it: the recorded box scores, leads, rosters, and players'
 * numbers. Anything else, like the news, answers with nothing.
 * @param {Parameters<typeof listLeagueAnswers>[0]} league
 */
function createStoreFetch(league) {
  const answers = listLeagueAnswers(league);
  return async (/** @type {string} */ url) =>
    answers.has(url)
      ? new Response(JSON.stringify(answers.get(url)))
      : new Response(null, { status: 201 });
}

/**
 * Every game of the season, from the whole season's schedule of the next day with the afternoon's
 * scoreboard, as the store keeps it.
 */
export function readWholeSeasonSchedule() {
  const snapshot = buildSnapshot(
    { ...AFTERNOON.responses, schedule: GAMES.preview.schedule },
    { season: 2026, now: Date.parse(NOW) },
  );
  return { version: snapshot.version, year: 2026, games: snapshot.schedule };
}

/**
 * The Worker's store, already updated once from the afternoon's feeds, with each upcoming game's
 * meetings from the schedule, and what its jobs keep: the rosters, players' numbers, every
 * player's averages with each team's leading scorers, and finals' box scores and leads.
 * @param {Parameters<typeof listLeagueAnswers>[0]} [league]
 */
async function createAfternoonStore(league = {}) {
  const loadSnapshot = async (season) => {
    const snapshot = readAfternoonSnapshot(season);
    const schedule = league.isScheduleRefused ? null : GAMES.preview.schedule;
    return { ...snapshot, meetings: listUpcomingMeetings(schedule, snapshot) };
  };
  const testStore = createTestStore(SeasonStore, {
    loadSnapshot,
    now: NOW,
    fetchImpl: createStoreFetch(league),
  });
  await testStore.store.alarm();
  // The store's jobs run beside the update, and finish before the page opens, so they never
  // overwrite what a test writes.
  await Promise.all(testStore.store.jobRuns.values());
  return testStore;
}

/**
 * A phone that has used the app before, last dismissing the Updates box before the afternoon's
 * latest day of finals, and having kept none of its release notes' times yet, so each note out
 * starts showing.
 * @param {import("@playwright/test").Page} page
 */
const keepUpdatesFromEarlierVisit = (page) =>
  page.addInitScript(() => {
    if (localStorage.getItem("updatesSeenAt") === null)
      localStorage.setItem("updatesSeenAt", String(Date.parse("2026-09-28T01:00:00Z")));
    if (localStorage.getItem("releaseNotesShownUntil") === null)
      localStorage.setItem("releaseNotesShownUntil", "{}");
  });

/**
 * A phone that dismissed the Updates box after every final a test could add, so the box stays
 * closed over the views a test is about.
 * @param {import("@playwright/test").Page} page
 */
const keepUpdatesDismissed = (page) =>
  page.addInitScript(() => localStorage.setItem("updatesSeenAt", String(Date.now() * 2)));

/** @typedef {"dismissed" | "shown" | "new"} UpdatesBoxStart */

/**
 * @param {import("@playwright/test").Page} page
 * @param {UpdatesBoxStart} updatesBox
 */
async function prepareUpdatesBox(page, updatesBox) {
  if (updatesBox === "dismissed") await keepUpdatesDismissed(page);
  if (updatesBox === "shown") await keepUpdatesFromEarlierVisit(page);
}

/**
 * The page as the Worker serves it, with the Worker's store behind it, already updated once from
 * the afternoon's feeds, and the game and team sheets' routes reading the store, and the recorded
 * answers for what it doesn't keep, unless the league is down by the time the page opens. On a
 * phone, a final a test adds would open the Updates box above every view, so by default it stays
 * `"dismissed"`, as the welcome a phone's browser opens on starts closed. A test about the box
 * opens it `"shown"`, as a phone that last dismissed it before the afternoon's latest day of
 * finals, and `"new"` keeps nothing, as a phone new to the app, or one whose storage refuses the
 * harness's writes.
 * @param {import("@playwright/test").Page} page
 * A past season's record is built from the afternoon's by its change in `pastSeasons`, by year.
 * The store keeps the afternoon's list of the season's games, its playoffs', or every game of the
 * season, regular season and all, for `isWholeSeason`.
 * @param {{ league?: Parameters<typeof listLeagueAnswers>[0], isLeagueDownForPage?: boolean, updatesBox?: UpdatesBoxStart, isShowingWelcome?: boolean, pastSeasons?: Record<number, (season: any) => any>, isWholeSeason?: boolean }} [options]
 */
export async function openApp(
  page,
  {
    league = {},
    isLeagueDownForPage = false,
    updatesBox = "dismissed",
    isShowingWelcome = false,
    pastSeasons = {},
    isWholeSeason = false,
  } = {},
) {
  await prepareUpdatesBox(page, updatesBox);
  const testStore = await createAfternoonStore(league);
  const { context, store } = testStore;
  const readSeason = async () => structuredClone(await context.ctx.storage.get("seasons/2026"));
  for (const [year, change] of Object.entries(pastSeasons))
    await context.ctx.storage.put(`seasons/${year}`, change(await readSeason()));
  if (isWholeSeason) await context.ctx.storage.put("schedules/2026", readWholeSeasonSchedule());
  const openSockets = await connectToStore(page, testStore);
  const fetchImpl = isLeagueDownForPage
    ? async () => new Response("", { status: 503 })
    : createLeagueFetch(league);
  const boxScores = createBoxScoreServer({ fetchImpl });
  const previews = createPreviewServer({ fetchImpl, now: () => Date.parse(NOW) });
  const leads = createLeadServer({ fetchImpl });
  const highlights = createHighlightsServer({ fetchImpl });
  const rosters = createRosterServer({ fetchImpl, now: () => Date.parse(NOW) });
  const players = createPlayerServer({
    loadRoster: rosters.loadRoster,
    fetchImpl,
    now: () => Date.parse(NOW),
  });
  const readDoc = (/** @type {string} */ key) => store.docs.read(key);
  await page.route(matchPath("/lead"), (route) =>
    answerFromWorker(route, (url) => leads.serveLead(url, readDoc)),
  );
  await page.route(matchPath("/box-score"), (route) =>
    answerFromWorker(route, (url) => boxScores.serveBoxScore(url, readDoc)),
  );
  await page.route(matchPath("/highlights"), (route) =>
    answerFromWorker(route, (url) => highlights.serveHighlights(url, readDoc)),
  );
  await page.route(matchPath("/preview"), (route) =>
    answerFromWorker(route, (url) => previews.servePreview(url, readDoc)),
  );
  await page.route(matchPath("/roster"), (route) =>
    answerFromWorker(route, (url) => rosters.serveRoster(url, readDoc)),
  );
  await page.route(matchPath("/player"), (route) =>
    answerFromWorker(route, (url) => players.servePlayer(url, readDoc)),
  );
  await loadPageAt(page, NOW, { isShowingWelcome });

  return {
    countOpenSockets: () => openSockets.length,
    // What the Worker reads for a game a page has open, and pushes to the pages watching it.
    /**
     * @param {string} id
     * @param {{ boxScore: any, lead: any }} details
     */
    saveGameDetails: (id, details) => store.docs.write(`games/${id}`, details),
    // A document the Worker saves, which the store pushes to the pages watching it.
    /**
     * @param {string} path
     * @param {any} data
     */
    writeDocument: (path, data) => store.docs.write(path, data),
    /**
     * A change to a document the Worker saves, which the store pushes to the pages watching it.
     * @param {string} path
     * @param {(doc: any) => any} change
     */
    changeDocument: async (path, change) =>
      store.docs.write(path, change(structuredClone(await store.docs.read(path)))),
    listWatchedPaths: () =>
      context.ctx
        .getWebSockets()
        .flatMap((socket) => socket.deserializeAttachment()?.watching ?? []),
    /** @param {(season: any) => any} change */
    changeSeason: async (change) => {
      await store.docs.write("seasons/2026", change(await readSeason()));
    },
    /**
     * A change the page's socket never hears of, as when a phone sleeps through it.
     * @param {(season: any) => any} change
     */
    changeSeasonWhileAway: async (change) => {
      await context.ctx.storage.put("seasons/2026", change(await readSeason()));
    },
    holdStore: () => holdStore(page),
    ...createWorkerControls(testStore),
    /**
     * The saved season as the store would hold it in the next year's off-season.
     * @param {number} year
     */
    moveSeasonTo: async (year) => {
      await context.ctx.storage.put(`seasons/${year}`, await readSeason());
      await context.ctx.storage.delete("seasons/2026");
      await context.ctx.storage.put("live/current", { season: year });
    },
  };
}

/**
 * Serves the page at its key's address behind an access code, as the Worker serves it, with the
 * afternoon's store behind it.
 * @param {import("@playwright/test").Page} page
 * @param {{ accessCode: string }} options
 */
export async function serveLockedApp(page, { accessCode }) {
  const testStore = await createAfternoonStore();
  return serveLockedPage(page, { worker, testStore, accessCode, now: NOW });
}

/**
 * Opens the page `serveLockedApp` serves.
 * @param {import("@playwright/test").Page} page
 * @param {{ accessCode: string }} options
 */
export async function openLockedApp(page, options) {
  const controls = await serveLockedApp(page, options);
  await page.goto(LOCKED_PAGE_PATH);
  return controls;
}

/**
 * Shows the Games view and finds the button of the game it names, brought into the list's view.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
export async function findGameButton(page, name) {
  const tab = page.getByRole("tab", { name: "Games" });
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  const button = page.locator("#seasonGames").getByRole("button", { name });
  await button.scrollIntoViewIfNeeded();
  return button;
}

// ESPN's highlights of Fever at Aces, Game 3 of the first round.
const RECORDED_HIGHLIGHTS = JSON.parse(
  readFileSync(new URL("../fixtures/2026-10-01-espn-highlights.json", import.meta.url), "utf8"),
);

/**
 * Has the store keep ESPN's recorded highlights for the game a button names, as its job would.
 * @param {import("@playwright/test").Page} page
 * @param {{ writeDocument: (path: string, data: any) => Promise<unknown> }} app
 * @param {string} name
 */
export async function keepHighlights(page, app, name) {
  const id = await (
    await findGameButton(page, name)
  ).evaluate(
    (button) => /** @type {HTMLElement | null} */ (button.closest("[data-game]"))?.dataset.game,
  );
  if (!id) throw new Error(`No game is named ${name}`);
  await app.writeDocument(`highlights/${id}`, describeHighlights(id, RECORDED_HIGHLIGHTS.summary));
}

/**
 * Opens the sheet of the game a button names, from the Games view.
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
export async function openGameSheet(page, name) {
  await (await findGameButton(page, name)).click();
  return page.locator("#gameSheet");
}

// The gap between the Games list's days, which a day brought to the top keeps under the bar.
const DAY_GAP_PX = 8;

/**
 * Where a day of the Games list sits: how far its top is under the list's, and whether any of the
 * day before it shows.
 * @param {import("@playwright/test").Page} page
 * @param {string} day
 */
const readDayPlace = (page, day) =>
  page.evaluate((shownDay) => {
    const list = /** @type {Element} */ (document.querySelector("#seasonGames .day-list"));
    const listed = /** @type {Element} */ (list.querySelector(`[data-day="${shownDay}"]`));
    const listTop = list.getBoundingClientRect().top;
    const previous = listed.previousElementSibling;
    return {
      gap: Math.round(listed.getBoundingClientRect().top - listTop),
      isDayBeforeShown: !!previous && previous.getBoundingClientRect().bottom > listTop + 0.5,
    };
  }, day);

/**
 * Expects `day` chosen in the strip and at the top of the Games list, a day's gap under the bar
 * with nothing of the day before it showing, and a finger just under the gap landing on it.
 * @param {import("@playwright/test").Page} page
 * @param {string} day
 */
export async function expectDayAtTop(page, day) {
  await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute("data-day", day);
  await expect
    .poll(() => readDayPlace(page, day))
    .toEqual({ gap: DAY_GAP_PX, isDayBeforeShown: false });
  const landing = await page.evaluate(() => {
    const list = /** @type {Element} */ (document.querySelector("#seasonGames .day-list"));
    const { top, left, width } = list.getBoundingClientRect();
    const found = document.elementFromPoint(left + width / 2, top + 20);
    return found?.closest(".listed-day")?.getAttribute("data-day") ?? null;
  });
  expect(landing).toBe(day);
}
