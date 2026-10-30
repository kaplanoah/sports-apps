// Each game as the snapshot reads it from MLB's schedule, and the slate of games the page follows:
// today's, the next day's, last night's, and each club's last and next games.

import { addDays, readEasternDay } from "#shared/days.js";
import { isPlayedBy } from "#shared/game-clubs.js";
import { isPastMidnight } from "../../../page/js/dates.js";
import { sortInScheduleOrder } from "../../../page/js/schedule-order.js";
import { MLB_TEAM, readClubId } from "../../../page/js/mlb-ids.js";

export const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

export const isFinal = (game) => readGameState(game.status || {}) === "final";
export const hasStarted = (game) => ["live", "final"].includes(readGameState(game.status || {}));
export const isLive = (game) => readGameState(game.status || {}) === "live";
const HALF_INNINGS = { Top: "top", Middle: "middle", Bottom: "bottom", End: "end" };
export const isHalfInning = (value) => Object.hasOwn(HALF_INNINGS, value);

const GAME_TYPES = new Set(["R", "F", "D", "L", "W"]);
// The Games view lists the All-Star Game among the clubs' games.
export const LISTED_GAME_TYPES = new Set([...GAME_TYPES, "A"]);

const REGULATION_INNINGS = 9;

export const listScheduleGames = (schedule) =>
  (schedule?.dates ?? []).flatMap((day) => day.games ?? []);

/**
 * The schedule with each game being played as its live feed has it: its status, its line score,
 * and its score.
 * @param {any} schedule
 * @param {Record<string, any> | undefined} liveGames
 */
export function applyLiveGames(schedule, liveGames) {
  if (!schedule || !liveGames) return schedule;
  const applyGame = (/** @type {any} */ game) => {
    const feed = liveGames[String(game.gamePk)];
    const linescore = feed?.liveData?.linescore;
    if (!linescore) return game;
    const readSide = (/** @type {"away" | "home"} */ side) => {
      const runs = linescore.teams?.[side]?.runs;
      return { ...game.teams?.[side], ...(isNumber(runs) && { score: runs }) };
    };
    return {
      ...game,
      status: { ...game.status, ...feed.gameData?.status },
      linescore,
      teams: { ...game.teams, away: readSide("away"), home: readSide("home") },
    };
  };
  return {
    ...schedule,
    dates: (schedule.dates ?? []).map((day) => ({
      ...day,
      games: (day.games ?? []).map(applyGame),
    })),
  };
}

/**
 * How many of the schedule's games have ended.
 * @param {any} schedule MLB's schedule
 */
export const countFinals = (schedule) => listScheduleGames(schedule).filter(isFinal).length;

// Postponed and cancelled games read "Final" in abstractGameState, and warmup reads "Live", so
// check the coded state first.
export function readGameState(status) {
  const isCalledOff =
    ["C", "D", "T", "U"].includes(status.codedGameState) ||
    /postpon|cancel|suspend/i.test(status.detailedState || "");
  if (isCalledOff) return "off";
  if (["S", "P"].includes(status.codedGameState)) return "pre";
  if (status.abstractGameState === "Live") return "live";
  if (status.abstractGameState === "Final") return "final";
  return "pre";
}

// MLB names a delay "Delayed Start" before the first pitch and "Delayed" after, with its cause apart.
function describeDelay(status) {
  if (!/^Delayed\b/.test(status.detailedState || "")) return null;
  return status.reason ? `Delayed: ${status.reason}` : "Delayed";
}

// Without gameInfo, three hours past the scheduled start is close enough to order finals.
function estimateEnd(game) {
  const info = game.gameInfo || {};
  const firstPitch = Date.parse(info.firstPitch || game.gameDate);
  if (Number.isNaN(firstPitch)) return null;
  const minutes = info.gameDurationMinutes || (info.firstPitch ? 0 : 180);
  return new Date(firstPitch + minutes * 60000).toISOString().replace(".000Z", "Z");
}

// Between halves MLB says "Middle" or "End", with the third out still counted.
function readHalfInning(linescore) {
  const state = linescore && linescore.inningState;
  return isHalfInning(state) ? HALF_INNINGS[state] : null;
}

const isBatting = (game) => game.half === "top" || game.half === "bottom";

// A live game's linescore names the pitcher in for each side, fielding and batting.
function readPitcherIn(linescore, teamId) {
  const side = [linescore?.defense, linescore?.offense].find((entry) => entry?.team?.id === teamId);
  return side?.pitcher?.id ?? null;
}

// A channel's name can carry its sponsor or a note on where it airs, and one shown on its
// streaming service too names both, split by a slash.
const SPONSOR_OR_NOTE = /,?\s+(presented by\b.*|\(.*\))$/i;

// MLB names a channel's app, or a channel by its owner's name, where the line shows the channel.
const CHANNEL_NAMES = { "ESPN App": "ESPN", "Amazon Prime Video": "Prime Video" };

/** @param {{ name?: string }} broadcast */
const listChannelNames = (broadcast) =>
  (broadcast.name ?? "")
    .replace(SPONSOR_OR_NOTE, "")
    .split("/")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => CHANNEL_NAMES[name] ?? name);

const isEnglishTv = (broadcast) => broadcast.type === "TV" && broadcast.language === "en";

// National channels come first, then each club's own, the visitors' before the home club's.
const rankBroadcast = (broadcast) =>
  broadcast.isNational ? 0 : broadcast.homeAway === "away" ? 1 : 2;

/** @param {any[]} [broadcasts] */
function listNetworks(broadcasts = []) {
  const shown = broadcasts
    .filter(isEnglishTv)
    .sort((first, second) => rankBroadcast(first) - rankBroadcast(second));
  return [...new Set(shown.flatMap(listChannelNames))];
}

export function normalizeGame(game) {
  const readSide = (key) => {
    const side = (game.teams && game.teams[key]) || {};
    const team = side.team || {};
    return {
      id: readClubId(team.id),
      name: team.name || "",
      score: side.score,
      starter: side.probablePitcher?.id ?? null,
      pitcherIn: readPitcherIn(game.linescore, team.id),
      record: side.leagueRecord,
    };
  };
  const status = game.status || {};
  const state = readGameState(status);
  const league = /^(AL|NL)\b/.exec(game.seriesDescription || "");
  return {
    id: String(game.gamePk),
    type: game.gameType,
    season: Number(game.season ?? game.officialDate?.slice(0, 4)),
    round: { F: "WC", D: "DS", L: "CS", W: "WS" }[game.gameType] ?? null,
    gameNumber: game.gameNumber ?? 1,
    date: game.officialDate,
    start: game.gameDate,
    tbd: !!status.startTimeTBD,
    state,
    away: readSide("away"),
    home: readSide("home"),
    inning: game.linescore ? game.linescore.currentInning : undefined,
    half: readHalfInning(game.linescore),
    outs: game.linescore ? game.linescore.outs : undefined,
    detail: status.detailedState,
    delay: describeDelay(status),
    doubleheader: game.doubleHeader && game.doubleHeader !== "N" ? game.gameNumber : null,
    number: game.seriesGameNumber,
    ifNecessary: game.ifNecessary === "Y",
    league: league ? league[1] : null,
    end: state === "final" ? estimateEnd(game) : null,
    networks: listNetworks(game.broadcasts),
  };
}

// The All-Star Game's teams are its leagues'.
const ALL_STAR_LEAGUES = { 159: "AL", 160: "NL" };

/**
 * The All-Star Game, when the schedule's days hold it, with its leagues for its clubs.
 * @param {any} schedule
 */
function findAllStarGame(schedule) {
  const game = listScheduleGames(schedule).find((each) => each.gameType === "A");
  return game ? normalizeAllStarGame(game) : null;
}

/** @param {any} game MLB's listing of the All-Star Game */
export function normalizeAllStarGame(game) {
  const normalized = normalizeGame(game);
  /** @param {"away" | "home"} key */
  const readLeague = (key) => ALL_STAR_LEAGUES[game.teams?.[key]?.team?.id] ?? null;
  return {
    ...normalized,
    away: { ...normalized.away, id: readLeague("away") },
    home: { ...normalized.home, id: readLeague("home") },
  };
}

// It sits beside the slate's lists rather than in them, since the header, the Updates box, and the
// store's box scores and pitchers follow the clubs' games, and only the Games view lists it.
function summarizeAllStarGame(game) {
  if (!game || game.state === "off") return null;
  const { starters, postseason, networks, ...summary } = summarizeGame(game, new Map());
  return { date: game.date, ...summary, allStar: true };
}

// A suspended game is listed again on the day it resumes; the later listing counts.
export function listScheduledGames(...responses) {
  const gamesByPk = new Map();
  for (const game of responses.flatMap(listScheduleGames))
    if (GAME_TYPES.has(game.gameType)) gamesByPk.set(game.gamePk, normalizeGame(game));
  return [...gamesByPk.values()];
}

export const hasBothClubs = (game) => !!(game.away.id && game.home.id);
export const hasClub = (game) => !!(game.away.id || game.home.id);
export const isFeedGamePlayedBy = (game, club) => game.away.id === club || game.home.id === club;
export const compareStarts = (first, second) => Date.parse(first.start) - Date.parse(second.start);
export const compareEnds = (first, second) => Date.parse(first.end) - Date.parse(second.end);

// A pitcher MLB couldn't describe keeps his id, so the page can still ask about him.
export function describeStarter(id, pitchers) {
  if (!id) return null;
  const person = pitchers.get(id);
  if (!person) return { id };
  const starter = { id, name: person.useLastName, hand: person.pitchHand?.code };
  return person.useName ? { ...starter, firstName: person.useName } : starter;
}

const isStillPitching = (game, side) =>
  game.state === "live" && side.starter !== null && side.pitcherIn === side.starter;

function describeSideStarter(game, side, pitchers) {
  const starter = describeStarter(side.starter, pitchers);
  return starter && isStillPitching(game, side) ? { ...starter, pitching: true } : starter;
}

// MLB names a game's probable starters ahead of it, and once it starts, the ones who did.
export function listStarters(game, pitchers) {
  if (game.state === "off") return null;
  const starters = [game.away, game.home].map((side) => describeSideStarter(game, side, pitchers));
  return starters.some(Boolean) ? starters : null;
}

// A final that went extra innings, or was called short, says in which inning it ended.
const isOffRegulation = (game) =>
  game.state === "final" && isNumber(game.inning) && game.inning !== REGULATION_INNINGS;

// A game that has ended, or won't be played, no longer says where it's on.
const isWatchable = (game) =>
  (game.state === "pre" || game.state === "live") && game.networks.length > 0;

export function summarizeGame(game, pitchers) {
  const summary = {
    id: game.id,
    season: game.season,
    round: game.round,
    gameNumber: game.gameNumber,
    away: game.away.id,
    home: game.home.id,
    state: game.state,
    start: game.start,
  };
  if (game.tbd) summary.tbd = true;
  if (game.doubleheader) summary.doubleheader = game.doubleheader;
  if (game.type !== "R") summary.postseason = true;
  if (game.state === "live" || game.state === "final")
    summary.score = [game.away.score || 0, game.home.score || 0];
  if (game.state === "live") summary.inning = game.inning || 1;
  if (game.state === "live" && game.half) summary.half = game.half;
  if (game.state === "live" && isBatting(game) && isNumber(game.outs)) summary.outs = game.outs;
  if (game.state === "final") summary.end = game.end;
  if (isOffRegulation(game)) summary.innings = game.inning;
  if (game.state === "off") summary.detail = game.detail;
  if (game.delay) summary.delay = game.delay;
  if (isWatchable(game)) summary.networks = game.networks;
  const starters = listStarters(game, pitchers);
  if (starters) summary.starters = starters;
  return summary;
}

// Every game on the dates of each club's last game before `day` and first after it, so a date
// that shows at all shows all its games.
// Postseason games list a club before its opponent is known, so one known club is enough.
function listClubGames(games, day, summarize) {
  const counted = games
    .filter((game) => game.state !== "off" && hasClub(game))
    .map((game) => ({ date: game.date, ...summarize(game) }));
  const played = sortInScheduleOrder(
    counted.filter((game) => game.state === "final" && game.date < day),
  );
  const ahead = sortInScheduleOrder(
    counted.filter((game) => game.state === "pre" && game.date > day),
  );
  const previousDates = new Set();
  const nextDates = new Set();
  for (const club of Object.values(MLB_TEAM)) {
    const last = played.filter((game) => isPlayedBy(game, club)).pop();
    const first = ahead.find((game) => isPlayedBy(game, club));
    if (last) previousDates.add(last.date);
    if (first) nextDates.add(first.date);
  }
  const listGamesOn = (clubGames, dates) => clubGames.filter((game) => dates.has(game.date));
  return { previous: listGamesOn(played, previousDates), next: listGamesOn(ahead, nextDates) };
}

// Before 6am Eastern, today is still last night while any of last night's games is unfinished.
// Once they're all final, last night stays alongside until 6am, since its games still explain
// what changes then.
function buildSlate(games, clubGames, now, pitchers) {
  const summarize = (game) => summarizeGame(game, pitchers);
  const { date: easternDate } = readEasternDay(now);
  const playable = games.filter((game) => game.state !== "off" && hasBothClubs(game));
  const listGamesOn = (date) =>
    sortInScheduleOrder(playable.filter((game) => game.date === date).map(summarize));
  const lastNight = addDays(easternDate, -1);
  const isNight = isPastMidnight(now);
  const isLastNightUnfinished = playable.some(
    (game) => game.date === lastNight && game.state !== "final",
  );
  const day = isNight && isLastNightUnfinished ? lastNight : easternDate;
  const hasLastNightEnded = isNight && day !== lastNight;

  const nextDay = [...new Set(playable.map((game) => game.date))]
    .filter((date) => date > day)
    .sort()[0];
  const lastFinal = playable
    .filter((game) => game.state === "final" && game.date < day)
    .sort(compareEnds)
    .pop();
  const postponed = sortInScheduleOrder(
    games
      .filter((game) => game.state === "off" && game.date === day && hasBothClubs(game))
      .map(summarize),
  );
  return {
    today: { date: day, games: listGamesOn(day), postponed },
    nextDay: nextDay ? { date: nextDay, games: listGamesOn(nextDay) } : null,
    lastNight: hasLastNightEnded ? { date: lastNight, games: listGamesOn(lastNight) } : null,
    lastFinal: lastFinal ? summarize(lastFinal) : null,
    ...listClubGames(clubGames, day, summarize),
  };
}

export const listPitchers = (responses) =>
  new Map((responses.pitchers?.people || []).map((person) => [person.id, person]));

/** @returns {ReturnType<typeof buildSlate> & { allStar?: any }} */
export function buildSlateWithAllStar(responses, games, clubGames, now) {
  const slate = buildSlate(games, clubGames, now, listPitchers(responses));
  const allStar = summarizeAllStarGame(findAllStarGame(responses.schedule));
  return allStar ? { ...slate, allStar } : slate;
}
