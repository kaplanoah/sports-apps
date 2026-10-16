import { BEST_OF, LEAGUES, countWinsNeeded, findFeederSeries, resolveBracket } from "./snapshot.js";

export const ROUND_LABEL = {
  WC: "Wild Card",
  DS: "Division Series",
  CS: "Championship Series",
  WS: "World Series",
};

function decideFromWins(state, seriesId, round, teamA, teamB) {
  if (!teamA || !teamB) return null;
  const record = state.series[seriesId] || {};
  const need = countWinsNeeded(round);
  if (record.winsA >= need) return teamA;
  if (record.winsB >= need) return teamB;
  return null;
}

// Seasons saved before series recorded `started` still count a series with a win as started.
function describeSeries(state, series) {
  const record = state.series[series.id] || {};
  return {
    ...series,
    winsA: record.winsA || 0,
    winsB: record.winsB || 0,
    started: !!record.started || !!(record.winsA || record.winsB),
    need: countWinsNeeded(series.round),
    bestOf: BEST_OF[series.round],
  };
}

const hasFullLeague = (state, league) =>
  Object.values(state.teams).filter((team) => team.league === league).length >= 6;

export function buildBracket(state) {
  const bracket = resolveBracket(state.teams, (seriesId, round, teamA, teamB) =>
    decideFromWins(state, seriesId, round, teamA, teamB),
  );
  const describe = (seriesId) => describeSeries(state, bracket[seriesId]);
  const [al, nl] = LEAGUES.map((league) => {
    if (!hasFullLeague(state, league)) return null;
    return {
      wc: [describe(`${league}_WC1`), describe(`${league}_WC2`)],
      ds: [describe(`${league}_DS1`), describe(`${league}_DS2`)],
      cs: [describe(`${league}_CS`)],
    };
  });
  return { al, nl, ws: al && nl ? describe("WS") : null };
}

function listSeries(bracket) {
  const leagueSeries = [bracket.al, bracket.nl]
    .filter(Boolean)
    .flatMap((league) => [...league.wc, ...league.ds, ...league.cs]);
  return bracket.ws ? [...leagueSeries, bracket.ws] : leagueSeries;
}

export const findSeries = (state, id) =>
  listSeries(buildBracket(state)).find((series) => series.id === id) || null;

// `side` is "A" or "B".
export function listSlotCandidates(state, seriesId, side) {
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

export function nameSeries(id) {
  if (id === "WS") return "World Series";
  const [league, key] = String(id).split("_");
  if (!key) return String(id);
  if (key === "CS") return `${league}CS`;
  if (key.startsWith("DS")) return `${league}DS`;
  return `${league} Wild Card Series`;
}
