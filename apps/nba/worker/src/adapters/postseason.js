import {
  BasketballPlayoffField,
  BasketballPlayInField,
  validateSportsData,
} from "../../../../../shared/worker/sports-schema.js";
import { fetchFeedJson } from "../../../../../shared/worker/upstream.js";

const HEADERS = {
  accept: "application/json",
};
/** @type {Record<string, "seven-eight" | "nine-ten" | "eighth-seed">} */
const STAGES = {
  "Play-In 7v8": "seven-eight",
  "Play-In 9v10": "nine-ten",
  "Play-In WvL": "eighth-seed",
};
const ROUND_SIZES = [0, 8, 4, 2, 1];
const TEAMS = new Map([
  [1610612737, "ATL"],
  [1610612738, "BOS"],
  [1610612739, "CLE"],
  [1610612740, "NOP"],
  [1610612741, "CHI"],
  [1610612742, "DAL"],
  [1610612743, "DEN"],
  [1610612744, "GSW"],
  [1610612745, "HOU"],
  [1610612746, "LAC"],
  [1610612747, "LAL"],
  [1610612748, "MIA"],
  [1610612749, "MIL"],
  [1610612750, "MIN"],
  [1610612751, "BKN"],
  [1610612752, "NYK"],
  [1610612753, "ORL"],
  [1610612754, "IND"],
  [1610612755, "PHI"],
  [1610612756, "PHX"],
  [1610612757, "POR"],
  [1610612758, "SAC"],
  [1610612759, "SAS"],
  [1610612760, "OKC"],
  [1610612761, "TOR"],
  [1610612762, "UTA"],
  [1610612763, "MEM"],
  [1610612764, "WAS"],
  [1610612765, "DET"],
  [1610612766, "CHA"],
]);

function requireValid(condition, field) {
  if (!condition) throw new Error(`Invalid NBA postseason ${field}`);
}

function readSide(record, prefix) {
  const id = record[`${prefix}SeedId`];
  const code = record[`${prefix}SeedTricode`];
  if (id === 0 && code === "") return { team: null, seed: null };
  requireValid(TEAMS.has(id) && TEAMS.get(id) === code, "team");
  return { team: code, seed: record[`${prefix}SeedRank`] };
}

function requireUnique(records) {
  requireValid(new Set(records.map((record) => record.id)).size === records.length, "duplicates");
}

/** @returns {import("../../../../../shared/worker/sports-schema.js").BasketballPlayoffFieldRecord["series"][number]} */
function readPlayoffSeries(record, season) {
  const round = record.roundNumber;
  const conference = record.seriesConference === "NBA Finals" ? null : record.seriesConference;
  const number = record.seriesNumber;
  requireValid(
    round === 4 ? conference === null : ["East", "West"].includes(conference),
    "conference",
  );
  return {
    id: `${season}-${round}-${conference ?? "Finals"}-${number}`,
    round,
    number,
    conference,
    high: { ...readSide(record, "high"), wins: record.highSeedSeriesWins },
    low: { ...readSide(record, "low"), wins: record.lowSeedSeriesWins },
  };
}

/** @returns {import("../../../../../shared/worker/sports-schema.js").BasketballPlayInFieldRecord["matchups"][number]} */
function readPlayInMatchup(record, season) {
  const stage = STAGES[record.matchupType];
  requireValid(!!stage, "stage");
  const gameId = record.nextGameId;
  requireValid(typeof gameId === "string", "game identity");
  requireValid(gameId === "" || gameId.trim().length > 0, "game identity");
  const start = record.nextGameDateTimeUTC;
  requireValid(start == null || typeof start === "string", "game start");
  return {
    id: `${season}-${record.conference}-${stage}`,
    conference: record.conference,
    stage,
    high: readSide(record, "high"),
    low: readSide(record, "low"),
    game: gameId
      ? {
          id: gameId,
          season,
          competition: "play-in",
          round: 0,
          gameNumber: 1,
          isCupFinal: false,
          start: start === "" ? null : (start ?? null),
        }
      : null,
  };
}

function readField(answer, season, kind) {
  const bracket = answer?.bracket;
  requireValid(bracket?.leagueId === "00", "league");
  requireValid(bracket.seasonYear === String(season), "season");
  const isPlayoffs = kind === "playoffs";
  const records = bracket[isPlayoffs ? "playoffBracketSeries" : "playInBracketSeries"];
  requireValid(Array.isArray(records), "records");
  if (isPlayoffs) {
    const series = records.map((record) => readPlayoffSeries(record, season));
    validateSportsData(BasketballPlayoffField, { season, series });
    requireUnique(series);
    for (let round = 1; round <= 4; round += 1) {
      requireValid(
        series.filter((record) => record.round === round).length <= ROUND_SIZES[round],
        "round size",
      );
    }
    return { season, series };
  }
  const matchups = records
    .filter((record) => record.matchupType !== "First Round")
    .map((record) => readPlayInMatchup(record, season));
  validateSportsData(BasketballPlayInField, { season, matchups });
  requireUnique(matchups);
  requireUnique(matchups.flatMap((matchup) => (matchup.game ? [{ id: matchup.game.id }] : [])));
  return { season, matchups };
}

/**
 * Brackets describe placements, never fresh game state or reminder eligibility.
 * @param {typeof fetch} fetchImpl
 */
export function createPostseasonAdapter(fetchImpl) {
  /** @param {number} season @param {"playoffs" | "play-in"} kind */
  return async function readPostseason(season, kind) {
    requireValid(Number.isInteger(season) && season >= 2000 && season <= 2100, "requested season");
    requireValid(kind === "playoffs" || kind === "play-in", "requested field");
    const query = new URLSearchParams({
      LeagueID: "00",
      SeasonYear: String(season),
      State: kind === "playoffs" ? "2" : "1",
    });
    const answer = await fetchFeedJson(
      fetchImpl,
      `https://stats.nba.com/stats/playoffbracket?${query}`,
      {
        feed: "NBA",
        headers: HEADERS,
        cacheSeconds: 5,
        hasData: (value) => !!value?.bracket,
      },
    );
    return readField(answer, season, kind);
  };
}

/** @param {"seven-eight" | "nine-ten" | "eighth-seed"} stage */
export function readPlayInAdvancement(stage) {
  if (stage === "seven-eight")
    return { winner: { seed: 7 }, loser: { stage: "eighth-seed", side: "high" } };
  if (stage === "nine-ten")
    return { winner: { stage: "eighth-seed", side: "low" }, loser: { eliminated: true } };
  requireValid(stage === "eighth-seed", "advancement stage");
  return { winner: { seed: 8 }, loser: { eliminated: true } };
}
