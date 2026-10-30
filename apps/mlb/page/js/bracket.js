import {
  BEST_OF,
  LEAGUES,
  countWinsNeeded,
  findFeederSeries,
  resolveBracket,
  readSeriesFacts,
} from "./bracket-rules.js";
import { keepLastRead } from "#shared/kept-read.js";

export const ROUND_LABEL = {
  WC: "Wild Card",
  DS: "Division Series",
  CS: "Championship Series",
  WS: "World Series",
};

function decideFromWins(series, seriesId, round, teamA, teamB) {
  if (!teamA || !teamB) return null;
  const record = series[seriesId] || {};
  const need = countWinsNeeded(round);
  if (record.winsA >= need) return teamA;
  if (record.winsB >= need) return teamB;
  return null;
}

// Seasons saved before series recorded `started` still count a series with a win as started.
function describeSeries(records, series) {
  const record = records[series.id] || {};
  return {
    ...series,
    winsA: record.winsA || 0,
    winsB: record.winsB || 0,
    started: !!record.started || !!(record.winsA || record.winsB),
    need: countWinsNeeded(series.round),
    bestOf: BEST_OF[series.round],
  };
}

const hasFullLeague = (teams, league) =>
  Object.values(teams).filter((team) => team.league === league).length >= 6;

// Every part of a draw asks for the bracket, so it's built once for each season's field and series.
const buildBracketFrom = keepLastRead(
  /** @param {Record<string, any>} teams @param {Record<string, any>} series */ (teams, series) => {
    const bracket = resolveBracket(teams, (seriesId, round, teamA, teamB) =>
      decideFromWins(series, seriesId, round, teamA, teamB),
    );
    const describe = (seriesId) => describeSeries(series, bracket[seriesId]);
    const [al, nl] = LEAGUES.map((league) => {
      if (!hasFullLeague(teams, league)) return null;
      return {
        wc: [describe(`${league}_WC1`), describe(`${league}_WC2`)],
        ds: [describe(`${league}_DS1`), describe(`${league}_DS2`)],
        cs: [describe(`${league}_CS`)],
      };
    });
    return { al, nl, ws: al && nl ? describe("WS") : null };
  },
);

export const buildBracket = (state) => buildBracketFrom(state.teams, state.series);

const listSeries = keepLastRead((/** @type {any} */ bracket) => {
  const leagueSeries = [bracket.al, bracket.nl]
    .filter(Boolean)
    .flatMap((league) => [...league.wc, ...league.ds, ...league.cs]);
  return bracket.ws ? [...leagueSeries, bracket.ws] : leagueSeries;
});

export const findSeries = (state, id) =>
  listSeries(buildBracket(state)).find((series) => series.id === id) || null;

// `side` is "A" or "B".
function listSlotCandidates(state, seriesId, side) {
  const seriesById = Object.fromEntries(
    listSeries(buildBracket(state)).map((series) => [series.id, series]),
  );
  const collectCandidates = (id, sideIndex) => {
    const series = seriesById[id];
    if (!series) return [];
    const team = sideIndex === 0 ? series.teamA : series.teamB;
    if (team) return [team];
    const feeder = findFeederSeries(id, sideIndex);
    return feeder ? [...collectCandidates(feeder, 0), ...collectCandidates(feeder, 1)] : [];
  };
  return collectCandidates(seriesId, side === "A" ? 0 : 1);
}

function findLoss(state, id) {
  const team = state.teams[id];
  if (!team) return null;
  const bracket = buildBracket(state);
  const league = team.league === "AL" ? bracket.al : bracket.nl;
  if (!league) return null;
  const played = [...league.wc, ...league.ds, ...league.cs, bracket.ws].filter(Boolean);
  return (
    played.find(
      (series) =>
        series.winner && series.winner !== id && (series.teamA === id || series.teamB === id),
    ) || null
  );
}

export const isEliminated = (state, id) => !!findLoss(state, id);

export function findSeriesBetween(state, first, second) {
  return (
    listSeries(buildBracket(state)).find(
      (series) =>
        series.teamA &&
        series.teamB &&
        [series.teamA, series.teamB].sort().join() === [first, second].sort().join(),
    ) || null
  );
}

/** @returns {"champion" | "out" | "alive"} */
export function describeTeamStatus(state, id) {
  if (buildBracket(state).ws?.winner === id) return "champion";
  return findLoss(state, id) ? "out" : "alive";
}

const listSideCandidates = (state, series, side) => {
  const team = side === "A" ? series.teamA : series.teamB;
  return team ? [team] : listSlotCandidates(state, series.id, side);
};

/**
 * The side of a series the viewer's ranking prefers: the one whose every club that could fill it
 * ranks above every club that could fill the other, or null when neither does.
 * @param {any} state
 * @param {any} series
 * @param {string[]} rankedOrder every club in the field, the viewer's first first
 * @returns {"A" | "B" | null}
 */
export function findPreferredSide(state, series, rankedOrder) {
  const findRank = (id) => {
    const index = rankedOrder.indexOf(id);
    return index === -1 ? Infinity : index;
  };
  const ranksA = listSideCandidates(state, series, "A").map(findRank);
  const ranksB = listSideCandidates(state, series, "B").map(findRank);
  if (!ranksA.length || !ranksB.length) return null;
  if (Math.max(...ranksA) < Math.min(...ranksB)) return "A";
  if (Math.max(...ranksB) < Math.min(...ranksA)) return "B";
  return null;
}

const readWinningPercentage = (team) =>
  team.w != null && team.l != null && team.w + team.l > 0 ? team.w / (team.w + team.l) : null;

/**
 * The side that hosts: the higher seed within a league, and in the World Series the better record.
 * @param {any} series
 * @param {Record<string, any>} teams the field
 * @returns {"A" | "B" | null}
 */
export function findHomeSide(series, teams) {
  if (!series.teamA || !series.teamB) return null;
  const teamA = teams[series.teamA];
  const teamB = teams[series.teamB];
  if (!teamA || !teamB) return null;
  if (series.round === "WS") {
    const percentageA = readWinningPercentage(teamA);
    const percentageB = readWinningPercentage(teamB);
    if (percentageA == null || percentageB == null) return null;
    return percentageA >= percentageB ? "A" : "B";
  }
  return teamA.seed <= teamB.seed ? "A" : "B";
}

/**
 * A series card's sides, top row first: the host on the bottom, as in a line score. In the Wild
 * Card and Division Series, teamA is the higher seed.
 * @param {any} series
 * @param {Record<string, any>} teams the field
 * @returns {["A", "B"] | ["B", "A"]}
 */
export function orderRows(series, teams) {
  const home = findHomeSide(series, teams);
  if (home) return home === "A" ? ["B", "A"] : ["A", "B"];
  return series.round === "WC" || series.round === "DS" ? ["B", "A"] : ["A", "B"];
}

const FIRST_PITCH_COUNTDOWN_MS = 30 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

/**
 * What a series card says in the half hour before its next game's first pitch: its delay, Warmup
 * once its start has passed, since first pitch often comes a few minutes after it, or the minutes
 * to go. Null outside that half hour, or for a game without a set time.
 * @param {{ start: string, tbd?: boolean, delay?: string }} game
 * @param {number} now
 * @returns {{ text: string, isDelayed: boolean } | null}
 */
export function describeFirstPitchWait(game, now) {
  if (game.tbd) return null;
  const msToStart = Date.parse(game.start) - now;
  if (msToStart > FIRST_PITCH_COUNTDOWN_MS) return null;
  if (game.delay) return { text: game.delay, isDelayed: true };
  if (msToStart <= 0) return { text: "Warmup", isDelayed: false };
  return {
    text: `First pitch in ${Math.ceil(msToStart / MS_PER_MINUTE)} min`,
    isDelayed: false,
  };
}

export function nameSeries(id) {
  if (id === "WS") return "World Series";
  const { league, round } = readSeriesFacts(String(id));
  if (!round) return String(id);
  if (round === "CS") return `${league}CS`;
  if (round === "DS") return `${league}DS`;
  return `${league} Wild Card Series`;
}
