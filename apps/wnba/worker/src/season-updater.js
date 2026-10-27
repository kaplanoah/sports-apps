import { isSameJson } from "#shared/compare.js";
import { readEasternDay } from "#shared/days.js";
import { nameTeam } from "../../page/js/series.js";
import { describeResult, describeWin, isPlayoffFinal } from "../../page/js/win-text.js";
import {
  capNotifications,
  describeAsNotification,
} from "../../../../shared/worker/notifications.js";
import { nameScheduleKey } from "../../page/js/snapshot.js";
import { nameMeetingsKey } from "./preview.js";
import { describeFailures } from "./snapshot.js";

// Keeps the current season's saved data up to date from the league, whether or not a page is
// open, and says which finished games and series are news. `docs` reads and writes the store's
// documents: read(key), list(collection), write(key, doc), update(key, change), and remove(key).

const SAVED_FIELDS = ["version", "games", "nearestGames", "series", "standings"];
// A game or series found finished long after it ended, as after a gap in updates, isn't news.
const RECENT_MS = 12 * 60 * 60 * 1000;

/** @param {number} year */
export const nameSeasonKey = (year) => `seasons/${year}`;
// The new year's season starts on the day of its first game, preseason included, as MLB's starts
// with spring training, or once its standings have games played. Until then the last one's stays
// current, its bracket and all, though the schedule already lists the new one's games.
const hasSeasonStarted = (snapshot, now) =>
  (!!snapshot.openingDay && readEasternDay(now).date >= snapshot.openingDay) ||
  snapshot.standings.some((row) => row.wins + row.losses > 0);

export async function loadCurrentSnapshot(loadSnapshot, now) {
  const { year } = readEasternDay(now);
  const upcoming = await loadSnapshot(year);
  return hasSeasonStarted(upcoming, now) ? upcoming : loadSnapshot(year - 1);
}

const STATE_ORDER = { pre: 0, live: 1, final: 2 };

// A saved final never goes back to an earlier state, since the schedule can still hold a game as
// under way once the scoreboard has dropped it. ESPN may not have every one of today's games, and
// one it lacks falls back to the schedule's copy, so while it stands in, a saved live game doesn't
// go back either.
/**
 * @param {any[] | undefined} savedGames
 * @param {any[]} games
 * @param {boolean} isStandIn
 */
function keepFurtherGames(savedGames, games, isStandIn) {
  const savedById = new Map((savedGames ?? []).map((game) => [game.id, game]));
  const firstKeptState = STATE_ORDER[isStandIn ? "live" : "final"];
  const isKept = (saved, game) =>
    STATE_ORDER[saved.state] >= firstKeptState &&
    STATE_ORDER[saved.state] > STATE_ORDER[game.state];
  return games.map((game) => {
    const saved = savedById.get(game.id);
    return saved && isKept(saved, game) ? saved : game;
  });
}

// A game's end is the time ESPN logged its last play, once the snapshot has it. Until then it's
// when the Worker, checking while the game is live, first finds it final. A game found final
// without being seen live has no end.
/**
 * @param {any} game
 * @param {any} saved
 * @param {string} asOf
 */
const readEnd = (game, saved, asOf) =>
  game.end ?? saved?.end ?? (saved?.state === "live" ? asOf : null);

// When the Worker first found a game final, for a game it had saved before then. Unlike its end,
// which ESPN's last play can set earlier than another final's, it only moves forward, so a page
// can tell a final it hasn't listed from one it has.
/**
 * @param {any} saved
 * @param {string} asOf
 */
const readFinalAt = (saved, asOf) =>
  saved?.finalAt ?? (saved && saved.state !== "final" ? asOf : null);

/**
 * Each final with what `readTimes` adds to it from its saved copy.
 * @param {any[] | undefined} savedGames
 * @param {any[]} games
 * @param {(game: any, saved: any) => object} readTimes
 */
function addToFinals(savedGames, games, readTimes) {
  const savedById = new Map((savedGames ?? []).map((game) => [game.id, game]));
  return games.map((game) =>
    game.state === "final" ? { ...game, ...readTimes(game, savedById.get(game.id)) } : game,
  );
}

/**
 * @param {any[] | undefined} savedGames
 * @param {any[]} games
 * @param {string} asOf
 */
const addEndTimes = (savedGames, games, asOf) =>
  addToFinals(savedGames, games, (game, saved) => {
    const end = readEnd(game, saved, asOf);
    return end ? { end } : {};
  });

/**
 * @param {any[] | undefined} savedGames
 * @param {any[]} games
 * @param {string} asOf
 */
const addFinalTimes = (savedGames, games, asOf) =>
  addToFinals(savedGames, games, (_game, saved) => {
    const finalAt = readFinalAt(saved, asOf);
    return finalAt ? { finalAt } : {};
  });

/**
 * A list of games as the season saves it, from the list saved before and the snapshot's.
 * @param {any[] | undefined} savedGames
 * @param {any[]} games
 * @param {{ isStandIn: boolean, asOf: string }} update
 */
function prepareGames(savedGames, games, { isStandIn, asOf }) {
  return addEndTimes(savedGames, keepFurtherGames(savedGames, games, isStandIn), asOf);
}

// Only the season's games keep when each was found final, for the Updates box, which reads them.
/**
 * @param {any[] | undefined} savedGames
 * @param {any[]} games
 * @param {{ isStandIn: boolean, asOf: string }} update
 */
const prepareSeasonGames = (savedGames, games, update) =>
  addFinalTimes(savedGames, prepareGames(savedGames, games, update), update.asOf);

// A feed that didn't answer leaves what it feeds as it was.
export async function saveSnapshot(docs, snapshot) {
  await saveSeason(docs, snapshot);
  await saveSchedule(docs, snapshot);
  if (!snapshot.missing.includes("schedule")) await saveMeetings(docs, snapshot);
}

// Each upcoming game's meetings, which its sheet reads through the Worker, kept for each pair of
// teams.
async function saveMeetings(docs, snapshot) {
  for (const pair of snapshot.meetings ?? []) {
    const key = nameMeetingsKey(pair.season, pair.teams);
    if (!isSameJson(await docs.read(key), pair)) await docs.write(key, pair);
  }
}

// The season's games need the same feeds as the record's.
async function saveSchedule(docs, snapshot) {
  const { hasGames, isStandIn } = readGameFeeds(snapshot);
  if (!hasGames) return;
  const key = nameScheduleKey(snapshot.season);
  const doc = await docs.read(key);
  const games = keepFurtherGames(doc?.games, snapshot.schedule, isStandIn);
  if (doc?.version === snapshot.version && isSameJson(doc.games, games)) return;
  await docs.write(key, {
    version: snapshot.version,
    year: snapshot.season,
    games,
    updatedAt: snapshot.asOf,
  });
}

// The league's schedule holds one season at a time, so once it lists the next season's games, the
// season before has no games in it and keeps the ones it saved.
/** @param {{ missing: string[], standIn?: string | null, isScoreboardIdle?: boolean, openingDay: string | null }} snapshot */
function readGameFeeds(snapshot) {
  const missing = new Set(snapshot.missing);
  const isStandIn = missing.has("scoreboard") && !!snapshot.standIn;
  const hasScores = !missing.has("scoreboard") || isStandIn || !!snapshot.isScoreboardIdle;
  const hasSchedule = !missing.has("schedule") && !!snapshot.openingDay;
  return { missing, isStandIn, hasGames: hasScores && hasSchedule };
}

// The games need both of their feeds: the schedule alone can be behind on today's, and the
// scoreboard alone has only today's, unless ESPN stood in for the scoreboard, or the scoreboard
// has no game to score (`isScoreboardGame` in page/js/snapshot.js). Series counted from games ESPN
// may lack wait for the bracket. The record's leading scorers are the player job's, saved with
// every player's averages (player-updater.js), so an update leaves them as they are.
const saveSeason = (docs, snapshot) =>
  docs.update(nameSeasonKey(snapshot.season), (saved) => describeSavedSeason(saved, snapshot));

/**
 * The season's record with what changed in the snapshot, or null when nothing did.
 * @param {any} saved the record as the store keeps it, or null before it keeps one
 * @param {any} snapshot
 */
function describeSavedSeason(saved, snapshot) {
  const doc = saved ?? { year: snapshot.season };
  const { missing, isStandIn, hasGames } = readGameFeeds(snapshot);
  const update = { isStandIn, asOf: snapshot.asOf };
  const saving = {
    ...snapshot,
    games: prepareSeasonGames(doc.games, snapshot.games, update),
    nearestGames: prepareGames(doc.nearestGames, snapshot.nearestGames, update),
  };
  const answered = {
    version: true,
    games: hasGames,
    nearestGames: hasGames,
    series: !missing.has("bracket") || (hasGames && !isStandIn),
    standings: !missing.has("standings"),
  };
  const changed = SAVED_FIELDS.filter(
    (field) => answered[field] && !isSameJson(doc[field], saving[field]),
  );
  if (!changed.length) return null;
  const fields = Object.fromEntries(changed.map((field) => [field, saving[field]]));
  return { ...doc, ...fields, updatedAt: snapshot.asOf };
}

export const readUpdates = (docs, year) => docs.read(nameSeasonKey(year));

export const readSchedule = (docs, year) => docs.read(nameScheduleKey(year));

// A feed with nothing to send is idle, like the scoreboard on a day without games, which the league
// may not send at all, so the page doesn't warn of it. Nor does it warn of the scoreboard while ESPN
// covers it, before ESPN's scores stand in for a game it has started.
export function describeSnapshotStatus(snapshot) {
  const missing = snapshot.missing || [];
  const isIdle = (feed) => feed === "scoreboard" && !!snapshot.isScoreboardIdle;
  return {
    error: missing.length ? "wnba_feeds_missing" : "",
    detail: missing.join(", "),
    idle: missing.filter(isIdle).join(", "),
    standIn: snapshot.standIn || (snapshot.isScoreboardCovered ? "espn" : ""),
    reasons: describeFailures(snapshot.failures ?? {}),
  };
}

export const STATUS_FIELDS = { idle: "", standIn: "", reasons: "" };

// A playoff final reads as the Updates box says it, and any other final as its result.
function describeFinal(game, games) {
  const markup = isPlayoffFinal(game)
    ? describeWin(game, games, nameTeam)
    : describeResult(game, nameTeam);
  return describeAsNotification(markup, `final:${game.id}`);
}

const isFinalGame = (game) => game?.state === "final";

/**
 * A notification for each game that finished since the last update, worded as the Updates box
 * words it.
 * @param {{ before: any, after: any, now: number }} change the saved season before and after
 */
export function listNotifications({ before, after, now }) {
  const wasFinal = new Set((before?.games ?? []).filter(isFinalGame).map((game) => game.id));
  const games = after?.games ?? [];
  const messages = games
    .filter((game) => isFinalGame(game) && !wasFinal.has(game.id))
    .filter((game) => Date.parse(game.start) >= now - RECENT_MS)
    .map((game) => describeFinal(game, games));
  return capNotifications(messages, (count) => `${count} more final scores`);
}
