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

// Keeps the current season's saved data up to date from the league, whether or not a page is
// open, and says which finished games and series are news. `docs` reads and writes the store's
// documents: read(key), list(collection), write(key, doc), and remove(key).

const SAVED_FIELDS = ["version", "games", "nearestGames", "series", "standings", "leaders"];
// A game or series found finished long after it ended, as after a gap in updates, isn't news.
const RECENT_MS = 12 * 60 * 60 * 1000;

const nameSeasonKey = (year) => `seasons/${year}`;
// Every player's averages keep a document of their own, which a page reads only for a Roster page,
// so the season it watches through every live game doesn't carry them.
const nameAveragesKey = (year) => `averages/${year}`;

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
function addEndTimes(savedGames, games, asOf) {
  const savedById = new Map((savedGames ?? []).map((game) => [game.id, game]));
  return games.map((game) => {
    if (game.state !== "final") return game;
    const saved = savedById.get(game.id);
    const end = game.end ?? saved?.end ?? (saved?.state === "live" ? asOf : null);
    return end ? { ...game, end } : game;
  });
}

/**
 * A list of games as the season saves it, from the list saved before and the snapshot's.
 * @param {any[] | undefined} savedGames
 * @param {any[]} games
 * @param {{ isStandIn: boolean, asOf: string }} update
 */
function prepareGames(savedGames, games, { isStandIn, asOf }) {
  return addEndTimes(savedGames, keepFurtherGames(savedGames, games, isStandIn), asOf);
}

// A feed that didn't answer leaves what it feeds as it was.
export async function saveSnapshot(docs, snapshot) {
  await saveSeason(docs, snapshot);
  await saveSchedule(docs, snapshot);
  if (!snapshot.missing.includes("players")) await saveAverages(docs, snapshot);
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

async function saveAverages(docs, snapshot) {
  const key = nameAveragesKey(snapshot.season);
  const doc = await docs.read(key);
  if (isSameJson(doc?.players, snapshot.averages)) return;
  await docs.write(key, {
    year: snapshot.season,
    players: snapshot.averages,
    updatedAt: snapshot.asOf,
  });
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
/** @param {{ missing: string[], standIn?: string | null, openingDay: string | null }} snapshot */
function readGameFeeds(snapshot) {
  const missing = new Set(snapshot.missing);
  const isStandIn = missing.has("scoreboard") && !!snapshot.standIn;
  const hasSchedule = !missing.has("schedule") && !!snapshot.openingDay;
  const hasGames = (!missing.has("scoreboard") || isStandIn) && hasSchedule;
  return { missing, isStandIn, hasGames };
}

// The games need both of their feeds: the schedule alone can be behind on today's, and the
// scoreboard alone has only today's, unless ESPN stood in for the scoreboard. Series counted from
// games ESPN may lack wait for the bracket.
async function saveSeason(docs, snapshot) {
  const key = nameSeasonKey(snapshot.season);
  const doc = (await docs.read(key)) ?? { year: snapshot.season };
  const { missing, isStandIn, hasGames } = readGameFeeds(snapshot);
  const update = { isStandIn, asOf: snapshot.asOf };
  const saving = {
    ...snapshot,
    games: prepareGames(doc.games, snapshot.games, update),
    nearestGames: prepareGames(doc.nearestGames, snapshot.nearestGames, update),
  };
  const answered = {
    version: true,
    games: hasGames,
    nearestGames: hasGames,
    series: !missing.has("bracket") || (hasGames && !isStandIn),
    standings: !missing.has("standings"),
    leaders: !missing.has("players"),
  };
  const changed = SAVED_FIELDS.filter(
    (field) => answered[field] && !isSameJson(doc[field], saving[field]),
  );
  if (!changed.length) return;
  const fields = Object.fromEntries(changed.map((field) => [field, saving[field]]));
  await docs.write(key, { ...doc, ...fields, updatedAt: snapshot.asOf });
}

export const readUpdates = (docs, year) => docs.read(nameSeasonKey(year));

export const readAverages = (docs, year) => docs.read(nameAveragesKey(year));

export const readSchedule = (docs, year) => docs.read(nameScheduleKey(year));

export function describeSnapshotStatus(snapshot) {
  const missing = snapshot.missing || [];
  return {
    error: missing.length ? "wnba_feeds_missing" : "",
    detail: missing.join(", "),
    standIn: snapshot.standIn || "",
  };
}

export const STATUS_FIELDS = { standIn: "" };

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
