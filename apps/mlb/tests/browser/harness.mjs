import { readFileSync } from "node:fs";
import * as MLBSnapshot from "../../page/js/snapshot.js";
import PAGE_FILES from "#page-files/mlb";
import { createAppWorker } from "../../../../shared/worker/app-worker.js";
import { describeBoxScore } from "../../worker/src/box-score.js";
import { describeHighlights } from "../../worker/src/highlights.js";
import {
  indexInjuredPlayers,
  listInjuredPlayers,
  nameInjuredKey,
} from "../../worker/src/injuries.js";
import {
  composePitcher,
  describePitcher,
  describeStarters,
  listQualifiedRequest,
  nameStartersKey,
  readSpeeds,
} from "../../worker/src/pitchers.js";
import {
  describeHitters,
  describeLastGames,
  describePlayer,
  indexPeople,
  listPeopleRequest,
  nameHittersKey,
  namePlayerKey,
} from "../../worker/src/players.js";
import {
  describeRoster,
  indexSeasonStats,
  isOnRoster,
  listRosterRequest,
  listSeasonStatsRequest,
  nameRosterKey,
} from "../../worker/src/rosters.js";
import { SeasonStore, forwardToStore } from "../../worker/src/store.js";
import {
  test,
  expect,
  createTestStore,
  connectToStore,
  loadPageAt,
  matchPath,
  serveLockedPage,
  LOCKED_PAGE_PATH,
} from "../../../../tests/browser/harness.mjs";
import { holdStore } from "../../../../tests/browser/hold-store.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";

const loadFixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
export const EVENING_FIXTURE = loadFixture("2026-09-24-evening");
// The 2025 season after the World Series, when nothing was left to play.
export const FINAL_2025_FIXTURE = loadFixture("2025-final");
// The evening of two division series games, with where each game is on.
export const BROADCASTS_FIXTURE = loadFixture("2026-10-07-broadcasts");
// What the Worker answers for each of that evening's Division Series games' box scores.
export const BOX_SCORES = Object.fromEntries(
  Object.entries(loadFixture("2026-10-07-games").feeds).map(([id, feed]) => [
    id,
    describeBoxScore(id, feed),
  ]),
);
// What the Worker answers for NLCS Game 1's box score as it stood with one out in the top of the
// 3rd, with its runs so far, who's on base, and who's up.
export const LIVE_BOX_SCORE = describeBoxScore(
  "849809",
  loadFixture("2026-10-11-plays").feeds["849809"],
);
const HIGHLIGHTS_FIXTURE = loadFixture("2026-10-07-highlights");
// What the Worker answers for the highlights of two of those games, Brewers at Padres and Rays at
// Yankees.
export const RECORDED_HIGHLIGHTS = Object.fromEntries(
  Object.keys(HIGHLIGHTS_FIXTURE.content).map((id) => [
    id,
    describeHighlights(id, HIGHLIGHTS_FIXTURE.content[id], HIGHLIGHTS_FIXTURE.plays[id]),
  ]),
);

const ROSTERS_FIXTURE = loadFixture("2026-10-08-rosters");
// The Guardians', Yankees', and Dodgers' rosters as the store keeps them, by their documents' paths.
export const ROSTER_DOCS = Object.fromEntries(
  Object.entries({ CLE: 114, NYY: 147, LAD: 119 }).map(([club, mlbTeamId]) => {
    const { season, answers } = ROSTERS_FIXTURE;
    const roster = describeRoster({
      club,
      season,
      roster: answers[listRosterRequest(mlbTeamId, season)],
      hitting: indexSeasonStats(answers[listSeasonStatsRequest(season, "hitting")]),
      pitching: indexSeasonStats(answers[listSeasonStatsRequest(season, "pitching")]),
    });
    return [nameRosterKey(club), roster];
  }),
);

// ESPN's MLB injury report on the evening of Oct 11, which says why each player on the injured
// list is there.
const OUT_PLAYERS = indexInjuredPlayers(
  listInjuredPlayers(loadFixture("2026-10-11-espn-injuries").report),
);

const PITCHERS_FIXTURE = loadFixture("2026-10-06-pitchers");
const RECORDED_CLUBS = { CLE: 114, NYY: 147, LAD: 119 };

/**
 * Every player on the Guardians', Yankees', and Dodgers' rosters, the hitters MLB ranks, and the
 * qualified starters, as the store keeps them, by their documents' paths.
 */
function buildPlayerDocs() {
  const { season, answers } = ROSTERS_FIXTURE;
  /** @param {object} [options] */
  const index = (group, options) =>
    indexSeasonStats(answers[listSeasonStatsRequest(season, group, options)]);
  const numbers = {
    hitting: index("hitting"),
    pitching: index("pitching"),
    postseasonHitting: index("hitting", { gameType: "P" }),
    postseasonPitching: index("pitching", { gameType: "P" }),
  };
  const people = indexPeople(answers[listPeopleRequest(season)]);
  const players = Object.entries(RECORDED_CLUBS).flatMap(([club, mlbTeamId]) =>
    answers[listRosterRequest(mlbTeamId, season)].roster.filter(isOnRoster).map((entry) => {
      const player = describePlayer({
        ...numbers,
        entry,
        club,
        season,
        person: people.get(entry.person.id) ?? null,
        lastGames: describeLastGames(ROSTERS_FIXTURE.gameLogs[entry.person.id] ?? {}),
        out: OUT_PLAYERS.get(nameInjuredKey(club, entry.person.fullName)) ?? null,
      });
      return [namePlayerKey(season, entry.person.id), player];
    }),
  );
  return Object.fromEntries([
    ...players,
    [
      nameHittersKey(season),
      describeHitters(answers[listSeasonStatsRequest(season, "hitting", { pool: "qualified" })]),
    ],
    [nameStartersKey(season), QUALIFIED_STARTERS],
  ]);
}

const QUALIFIED_STARTERS = describeStarters(
  PITCHERS_FIXTURE.answers[listQualifiedRequest(2026)],
  readSpeeds(PITCHERS_FIXTURE.people[2026]),
);
export const PLAYER_DOCS = buildPlayerDocs();

/**
 * What the Worker answers for each recorded starter's matchup side, by id.
 * @type {Record<number, object>}
 */
export const PITCHER_SIDES = Object.fromEntries(
  PITCHERS_FIXTURE.people[2026].map((/** @type {any} */ person) => {
    const gameLog = PITCHERS_FIXTURE.gameLogs[2026].find(
      (/** @type {any} */ each) => each.id === person.id,
    );
    const pitcher = describePitcher(person, gameLog);
    return [
      person.id,
      composePitcher(pitcher, QUALIFIED_STARTERS, Date.parse(PITCHERS_FIXTURE.recordedAt)),
    ];
  }),
);

export const buildFixtureSnapshot = (fixture) =>
  MLBSnapshot.buildSnapshot(fixture.responses, {
    season: fixture.season,
    now: Date.parse(fixture.now),
  });

/**
 * A season's record as the Worker saves it from its first snapshot.
 * @param {any} snapshot
 */
export const buildSeasonRecord = (snapshot) => ({
  year: snapshot.season,
  version: snapshot.version,
  updatedAt: snapshot.asOf,
  teams: snapshot.teams,
  series: snapshot.series,
  projected: snapshot.projected,
  springStart: snapshot.springStart,
  standings: snapshot.standings,
  slate: snapshot.slate,
  log: snapshot.log,
});

// MLB's whole 2026 schedule, recorded on Oct 9, as it stood on the evening of Sep 24: each game
// from that evening on still to play, with neither its record nor its starters named yet, and the
// postseason left to the evening's own recording. The evening's days around today, recorded
// before the page asked for each club's record, stand aside, as the slate carries their games.
const SEASON_GAMES_FIXTURE = loadFixture("2026-10-09-season");

/** @param {any} game */
function rewindGame(game) {
  game.status = {
    abstractGameState: "Preview",
    codedGameState: "S",
    detailedState: "Scheduled",
    startTimeTBD: game.status.startTimeTBD,
  };
  for (const side of [game.teams.away, game.teams.home]) {
    delete side.score;
    delete side.leagueRecord;
    delete side.probablePitcher;
  }
}

/**
 * @param {any} seasonGames MLB's whole schedule
 * @param {string} now
 */
function rewindSeasonGames(seasonGames, now) {
  const rewound = structuredClone(seasonGames);
  for (const day of rewound.dates) {
    day.games = day.games.filter((game) => game.gameType === "R" || game.gameType === "A");
    const isCalledOff = (game) => ["C", "D"].includes(game.status.codedGameState);
    for (const game of day.games)
      if (Date.parse(game.gameDate) >= Date.parse(now) && !isCalledOff(game)) rewindGame(game);
  }
  return rewound;
}

/**
 * The season's games, a month to a document, as the Worker saves them from the evening's snapshot.
 * @type {Record<string, object>}
 */
export const SCHEDULE_DOCS = (() => {
  const responses = {
    ...EVENING_FIXTURE.responses,
    schedule: null,
    seasonGames: rewindSeasonGames(SEASON_GAMES_FIXTURE.responses.seasonGames, EVENING_FIXTURE.now),
  };
  const snapshot = buildFixtureSnapshot({ ...EVENING_FIXTURE, responses });
  return Object.fromEntries(
    Object.entries(snapshot.schedule).map(([month, games]) => [
      MLBSnapshot.nameScheduleKey(snapshot.season, month),
      { version: snapshot.version, year: snapshot.season, month, games, updatedAt: snapshot.asOf },
    ]),
  );
})();

// The 2025 season's record, filled in whole once it was over.
export const SEASON_2025 = buildSeasonRecord(buildFixtureSnapshot(FINAL_2025_FIXTURE));

// The first game still to come, Astros at Athletics, with both clubs' starters named.
// Every qualified starter's number in each measure, as the Worker sends it with a starter's side.
const QUALIFIED_SPREAD = /** @type {any} */ (Object.values(PITCHER_SIDES)[0]).starters.values;

// What the Worker answers for Astros at Athletics' starters, Blubaugh and Springs.
const describeStarter = (id, [firstName, lastName], hand, line, ranks, pitches) => ({
  id,
  firstName,
  lastName,
  hand,
  age: 27,
  line,
  ranks,
  starters: { count: 46, values: QUALIFIED_SPREAD },
  pitches,
  starts: [
    { date: "2026-09-19", opp: "SEA", home: true, ip: "5.2", runs: 2, k: 6, pitches: 97 },
    { date: "2026-09-13", opp: "TEX", home: false, ip: "6.0", runs: 0, k: 8, pitches: 88 },
  ],
});
export const MATCHUP_STARTERS = {
  1: describeStarter(
    1,
    ["AJ", "Blubaugh"],
    "R",
    { starts: 28, era: "3.66", k9: 9.1, bb9: 3.4, speed: 95.4 },
    {
      era: { rank: 17, of: 46 },
      k9: { rank: 3, of: 46 },
      bb9: { rank: 33, of: 46 },
      speed: { rank: 10, of: 46 },
    },
    [
      { code: "FF", name: "Four-seam FB", share: 0.52, mph: 95.4 },
      { code: "SL", name: "Slider", share: 0.3, mph: 86.1 },
      { code: "CH", name: "Changeup", share: 0.17, mph: 87.0 },
      { code: "CS", name: "Slow Curve", share: 0.01, mph: 74.0 },
    ],
  ),
  2: describeStarter(
    2,
    ["Jeffrey", "Springs"],
    "L",
    { starts: 24, ip: "128.2", era: "4.02", k9: 7.7, bb9: 2.9, speed: 90.8 },
    {
      era: { rank: 29, of: 46 },
      k9: { rank: 26, of: 46 },
      bb9: { rank: 20, of: 46 },
      speed: { rank: 43, of: 46 },
    },
    [
      { code: "FF", name: "Four-seam FB", share: 0.4, mph: 90.8 },
      { code: "CH", name: "Changeup", share: 0.35, mph: 79.5 },
    ],
  ),
};

export function buildSnapshotWithStarters() {
  const fixture = structuredClone(EVENING_FIXTURE);
  const game = fixture.responses.schedule.dates
    .flatMap((date) => date.games)
    .find((candidate) => candidate.gamePk === 824950);
  game.teams.away.probablePitcher = { id: 1 };
  game.teams.home.probablePitcher = { id: 2 };
  const describePerson = (id, useLastName, code, era) => ({
    id,
    useLastName,
    pitchHand: { code },
    stats: [{ splits: [{ stat: { era } }] }],
  });
  fixture.responses.pitchers = {
    people: [describePerson(1, "Blubaugh", "R", "3.66"), describePerson(2, "Springs", "L", "4.02")],
  };
  return buildFixtureSnapshot(fixture);
}

export { test, expect, matchPath, LOCKED_PAGE_PATH };

// A phone's screen and touch, where the Updates box shows.
export const ON_A_PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

const isWriteRequest = (request) => request.method() !== "GET";

/**
 * The page as the Worker serves it, with the Worker's store behind it. The store starts with the
 * current season's record, as the Worker's last update saved it, under any fields `store` gives
 * it, unless MLB isn't available.
 * @param {import("@playwright/test").Page} page
 * @param {object} [options]
 * @param {Record<string, object>} [options.store] documents by path
 * @param {string} [options.now]
 * @param {object} [options.snapshots]
 * @param {boolean} [options.liveAvailable]
 * @param {boolean} [options.portalReadsDocuments] a captive portal answers reading a document
 * @param {Record<number, object>} [options.pitchers] what the Worker answers for each pitcher id
 * @param {Record<string, object>} [options.rotations] what the Worker answers for each club's last
 *   starters
 * @param {Record<string, object>} [options.boxScores] what the Worker answers for each game id
 * @param {Record<string, object>} [options.highlights] the highlights the Worker answers for each
 *   game id, MLB's recorded ones unless a test says otherwise, and for any other game none
 * @param {boolean} [options.isWholeSeason] whether the store keeps the season's whole schedule,
 *   which most tests can do without
 */
export async function openApp(
  page,
  {
    store = {},
    now = EVENING_FIXTURE.now,
    snapshots = {},
    liveAvailable = true,
    portalReadsDocuments = false,
    pitchers = {},
    rotations = {},
    boxScores = {},
    highlights = RECORDED_HIGHLIGHTS,
    isWholeSeason = false,
  } = {},
) {
  const snapshotsBySeason = {
    [EVENING_FIXTURE.season]: buildFixtureSnapshot(EVENING_FIXTURE),
    [FINAL_2025_FIXTURE.season]: buildFixtureSnapshot(FINAL_2025_FIXTURE),
    ...snapshots,
  };
  const harness = {
    storeReads: [],
    transformSnapshot: (snapshot) => snapshot,
  };
  const loadSnapshot = async (season) =>
    harness.transformSnapshot(structuredClone(snapshotsBySeason[season]));
  const currentPath = `seasons/${EVENING_FIXTURE.season}`;
  const savedDocs = liveAvailable
    ? {
        [currentPath]: {
          ...buildSeasonRecord(snapshotsBySeason[EVENING_FIXTURE.season]),
          ...store[currentPath],
        },
      }
    : {};
  const testStore = createTestStore(SeasonStore, {
    loadSnapshot,
    now,
    stored: { ...(isWholeSeason && SCHEDULE_DOCS), ...store, ...savedDocs },
  });
  const { context, store: seasonStore } = testStore;

  const openSockets = await connectToStore(page, testStore);
  await page.route(matchPath("/pitcher"), (route) => {
    const pitcher = pitchers[Number(new URL(route.request().url()).searchParams.get("id"))];
    if (!pitcher) return route.fulfill({ status: 502, json: { error: "Couldn't read MLB: test" } });
    return route.fulfill({ json: pitcher });
  });
  await page.route(matchPath("/rotation"), (route) => {
    const rotation = rotations[new URL(route.request().url()).searchParams.get("club")];
    if (!rotation)
      return route.fulfill({ status: 502, json: { error: "Couldn't read MLB: test" } });
    return route.fulfill({ json: rotation });
  });
  await page.route(matchPath("/box-score"), (route) => {
    const boxScore = boxScores[new URL(route.request().url()).searchParams.get("id") ?? ""];
    if (!boxScore)
      return route.fulfill({ status: 502, json: { error: "Couldn't read MLB: test" } });
    return route.fulfill({ json: boxScore });
  });
  await page.route(matchPath("/highlights"), (route) => {
    const id = new URL(route.request().url()).searchParams.get("id") ?? "";
    return route.fulfill({ json: highlights[id] ?? { id, recap: null, story: null, plays: [] } });
  });
  await page.route(matchPath("/store/"), (route) => {
    const url = new URL(route.request().url());
    if (!isWriteRequest(route.request())) harness.storeReads.push(url.pathname + url.search);
    // A captive portal answers in place of the Worker.
    const isDocumentRead =
      route.request().method() === "GET" && /^\/store\/[^/]+\/[^/]+$/.test(url.pathname);
    if (portalReadsDocuments && isDocumentRead)
      return route.fulfill({ contentType: "text/html", body: "<h1>Sign in to Wi-Fi</h1>" });
    return route.fallback();
  });
  await loadPageAt(page, now);

  const readDocument = async (path) => (await context.ctx.storage.get(path)) ?? null;
  // The Worker finding the official bracket set, which the Updates box lists.
  const lockBracket = async (save) => {
    const season = (await readDocument("seasons/2026")) ?? { year: 2026 };
    await save("seasons/2026", {
      ...season,
      log: [...(season.log ?? []), { kind: "lock", at: now }],
    });
  };

  return {
    readDocument,
    // A change the Worker saves, which it sends each open page.
    writeFromWorker: (path, data) => seasonStore.docs.write(path, data),
    // A change the page's socket never hears of, as when a phone sleeps through it.
    writeWhileAway: (path, data) => context.ctx.storage.put(path, data),
    lockBracket: () => lockBracket(seasonStore.docs.write),
    lockBracketWhileAway: () => lockBracket((path, data) => context.ctx.storage.put(path, data)),
    /** @param {(season: any) => any} change */
    changeSeasonWhileAway: async (change) => {
      await context.ctx.storage.put(
        currentPath,
        change(structuredClone(await readDocument(currentPath))),
      );
    },
    holdStore: () => holdStore(page),
    // What the Worker's alarm does on its own schedule.
    updateFromWorker: () => testStore.fireAlarm(),
    countSeasonReads: () =>
      harness.storeReads.filter((path) => path === `/store/${currentPath}`).length,
    listStoreReads: () => [...harness.storeReads],
    countSubscriptions: () =>
      [...context.stored.keys()].filter((key) => key.startsWith("push:subscription:")).length,
    /** @param {(snapshot: any) => any} transform */
    changeSnapshots: (transform) => {
      harness.transformSnapshot = transform;
    },
    countOpenSockets: () => openSockets.length,
    dropConnections: async () => {
      await Promise.all(openSockets.map((socket) => socket.close()));
      openSockets.length = 0;
      context.sockets.length = 0;
    },
  };
}

/**
 * The page as openApp opens it, showing the bracket, which the afternoon's regular season keeps
 * behind the Standings tab's pill.
 * @param {import("@playwright/test").Page} page
 * @param {Parameters<typeof openApp>[1]} [options]
 */
export async function openBracket(page, options) {
  const app = await openApp(page, options);
  await openSeasonPart(page, "Bracket");
  return app;
}

/**
 * What the device kept from an earlier visit, which a reload leaves as the page last kept it.
 * @param {import("@playwright/test").Page} page
 * @param {string} key
 * @param {unknown} value
 */
export const keepFromEarlierVisit = (page, key, value) =>
  page.addInitScript(
    ([storedKey, text]) => {
      if (localStorage.getItem(storedKey) === null) localStorage.setItem(storedKey, text);
    },
    [key, JSON.stringify(value)],
  );

/**
 * Reads the color a token of the page's theme names, as the page draws it.
 * @param {import("@playwright/test").Page} page
 * @param {string} token
 */
export const readColor = (page, token) =>
  page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

/**
 * What the page kept on the device under `key`.
 * @param {import("@playwright/test").Page} page
 * @param {string} key
 */
export const readKept = (page, key) =>
  page.evaluate((storedKey) => JSON.parse(localStorage.getItem(storedKey) ?? "null"), key);

/**
 * Swipes a finger down a sheet from `target`, one step per move. It runs inside the page
 * so the time between moves is exact, which the sheet reads as the swipe's speed.
 * @param {import("@playwright/test").Page} page
 * @param {{ target: string, distance: number, steps: number, stepMs: number, isCancelled?: boolean }} swipe
 */
export const swipeSheetDown = (page, { target, distance, steps, stepMs, isCancelled = false }) =>
  page
    .locator(target)
    .first()
    .evaluate(
      (element, { distance, steps, stepMs, isCancelled }) => {
        const box = element.getBoundingClientRect();
        const x = box.x + box.width / 2;
        const startY = box.y + box.height / 2;
        const send = (type, y) => {
          const touch = new Touch({ identifier: 1, target: element, clientX: x, clientY: y });
          const isLifted = type === "touchend" || type === "touchcancel";
          const init = { changedTouches: [touch], bubbles: true, cancelable: true };
          element.dispatchEvent(
            new TouchEvent(type, { ...init, touches: isLifted ? [] : [touch] }),
          );
        };
        const wait = () => {
          const until = performance.now() + stepMs;
          while (performance.now() < until);
        };
        send("touchstart", startY);
        for (let step = 1; step <= steps; step++) {
          wait();
          send("touchmove", startY + (distance * step) / steps);
        }
        wait();
        send(isCancelled ? "touchcancel" : "touchend", startY + distance);
      },
      { distance, steps, stepMs, isCancelled },
    );

export const openSettings = (page) =>
  page.getByRole("button", { name: "Settings", exact: true }).click();

/**
 * Picks a season in the settings panel, then closes it.
 * @param {import("@playwright/test").Page} page
 * @param {string} year
 */
export async function chooseSeason(page, year) {
  await openSettings(page);
  await page.getByRole("combobox", { name: "Season" }).selectOption(year);
  await page.keyboard.press("Escape");
}

/**
 * Serves the page at its key's address behind an access code, as the Worker serves it, with the
 * evening's scores in place of MLB's.
 * @param {import("@playwright/test").Page} page
 * @param {{ accessCode: string }} options
 */
export function serveLockedApp(page, { accessCode }) {
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  const loadSnapshot = async () => structuredClone(snapshot);
  const testStore = createTestStore(SeasonStore, { loadSnapshot, now: EVENING_FIXTURE.now });
  const worker = createAppWorker({
    pageFiles: PAGE_FILES,
    forwardToStore,
    isStoreAnswering: async () => true,
  });
  return serveLockedPage(page, { worker, testStore, accessCode, now: EVENING_FIXTURE.now });
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
