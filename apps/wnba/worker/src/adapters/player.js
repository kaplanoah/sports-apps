import {
  BasketballPlayerNumbers,
  BasketballPlayerTotals,
  BasketballPlayerGame,
  BasketballTeamGame,
  BasketballRanks,
  validateSportsData,
} from "../../../../../shared/worker/sports-schema.js";
import { createReusedLoader } from "../../../../../shared/worker/upstream.js";

import { averageTotals, readPerGame, readShare, splitName } from "../season-averages.js";
import { fetchWnbaJson, hasTable, isCurrentSeason, readRequiredTable, readTable } from "../wnba.js";

const WNBA_STATS = "https://stats.wnba.com/stats";
export const REGULAR_SEASON = "Regular Season";
export const PLAYOFFS = "Playoffs";
// The season's logs and totals change after each game, and a past season's never.
const CACHE_SECONDS = 10 * 60;
const PAST_CACHE_SECONDS = 24 * 60 * 60;
// A sheet opened again soon, on this phone or another, reuses what was just read.
const REUSE_MS = 5 * 60 * 1000;

// The WNBA ranks a player among its leaders once she has played 31 of the season's 44 games or
// reached a season's total in that stat, and in a percentage once she has made enough shots. Part
// way through a season, each is that share of it.
const FULL_SEASON_GAMES = 44;
const LEADER_GAMES = 31;

/**
 * @typedef {Partial<Omit<NonNullable<import("../../../../../shared/worker/sports-schema.js").PlayerNumbersRecord["totals"]>, "PLAYER_NAME">>} NumericTotals
 */

/**
 * @typedef {object} RankedStat
 * @property {string} key what the page calls it
 * @property {(row: NumericTotals) => number | null} read her number, from her totals
 * @property {(row: NumericTotals) => number} [count] what the rule counts, from her
 *   totals, for a stat a season's total ranks her in short of the games
 * @property {number} [needed] how many of it the rule asks for over a whole season
 * @property {boolean} [isShare] whether the rule counts only what she counts, not her games
 * @property {boolean} [isFewestFirst] whether the fewest ranks first, as turnovers do
 */

/** @type {RankedStat[]} */
const RANKED_STATS = [
  { key: "points", read: readPerGame("PTS"), count: (row) => row.PTS, needed: 525 },
  { key: "rebounds", read: readPerGame("REB"), count: (row) => row.REB, needed: 260 },
  { key: "assists", read: readPerGame("AST"), count: (row) => row.AST, needed: 150 },
  { key: "steals", read: readPerGame("STL"), count: (row) => row.STL, needed: 55 },
  { key: "blocks", read: readPerGame("BLK"), count: (row) => row.BLK, needed: 40 },
  { key: "turnovers", read: readPerGame("TOV"), isFewestFirst: true },
  {
    key: "fieldGoalShare",
    read: readShare("FGM", "FGA"),
    count: (row) => row.FGM,
    needed: 110,
    isShare: true,
  },
  {
    key: "threeShare",
    read: readShare("FG3M", "FG3A"),
    count: (row) => row.FG3M,
    needed: 30,
    isShare: true,
  },
  {
    key: "freeThrowShare",
    read: readShare("FTM", "FTA"),
    count: (row) => row.FTM,
    needed: 55,
    isShare: true,
  },
];

// Two numbers this close are the same, however the division rounds.
const SAME_NUMBER = 1e-9;

// The columns each feed's rows are kept with: only what the sheet reads.
export const TOTALS_COLUMNS = [
  "PLAYER_ID",
  "PLAYER_NAME",
  "GP",
  "MIN",
  "PTS",
  "REB",
  "AST",
  "STL",
  "BLK",
  "TOV",
  "FGM",
  "FGA",
  "FG3M",
  "FG3A",
  "FTM",
  "FTA",
];
// The totals are read with each player's team too, for her team's Roster and its leading scorers.
export const TOTALS_FEED_COLUMNS = [...TOTALS_COLUMNS, "TEAM_ID"];
export const GAME_LOG_COLUMNS = [
  ...TOTALS_COLUMNS.filter((column) => column !== "GP"),
  "TEAM_ID",
  "GAME_ID",
  "GAME_DATE",
  "WL",
];
export const TEAM_GAME_COLUMNS = ["TEAM_ID", "GAME_ID", "PTS", "PLUS_MINUS", "MIN"];

/**
 * @param {any} answer
 * @param {string} table
 */
export function validatePlayerFeed(answer, table) {
  for (const row of readRequiredTable(answer, table)) {
    if (table === "LeagueGameLog") {
      validateSportsData(BasketballTeamGame, {
        teamId: row.TEAM_ID,
        gameId: row.GAME_ID,
        points: row.PTS,
        plusMinus: row.PLUS_MINUS,
        opponentPoints: row.PTS - row.PLUS_MINUS,
        minutes: row.MIN,
      });
    } else {
      validateSportsData(BasketballPlayerTotals.shape.PLAYER_ID, row.PLAYER_ID);
      validateSportsData(BasketballPlayerTotals.shape.PLAYER_NAME, row.PLAYER_NAME);
      validateSportsData(BasketballPlayerNumbers.shape.name, splitName(row.PLAYER_NAME));
      if (table === "LeagueDashPlayerStats") validateSportsData(BasketballPlayerTotals, row);
      else validateSportsData(BasketballPlayerGame, describeGame(row, false, []));
    }
  }
  return answer;
}

/**
 * A season's game logs: one player's, or every player's when no player is named.
 * @param {number} season
 * @param {string} seasonType
 * @param {string} [playerId]
 */
export const nameGameLogRequest = (season, seasonType, playerId) =>
  `${WNBA_STATS}/playergamelogs?${new URLSearchParams({
    LeagueID: "10",
    ...(playerId && { PlayerID: playerId }),
    Season: String(season),
    SeasonType: seasonType,
  })}`;

/**
 * Every team's games in a season.
 * @param {number} season
 * @param {string} seasonType
 */
export const nameTeamGameLogRequest = (season, seasonType) =>
  `${WNBA_STATS}/leaguegamelog?${new URLSearchParams({
    Counter: "0",
    Direction: "DESC",
    LeagueID: "10",
    PlayerOrTeam: "T",
    Season: String(season),
    SeasonType: seasonType,
    Sorter: "DATE",
  })}`;

/**
 * Every player's totals in a regular season, which her sheet, her team's Roster, and its leading
 * scorers are all worked out from.
 * @param {number} season
 */
export const nameTotalsRequest = (season) =>
  `${WNBA_STATS}/leaguedashplayerstats?${new URLSearchParams({
    College: "",
    Conference: "",
    Country: "",
    DateFrom: "",
    DateTo: "",
    Division: "",
    DraftPick: "",
    DraftYear: "",
    GameScope: "",
    GameSegment: "",
    Height: "",
    LastNGames: "0",
    LeagueID: "10",
    Location: "",
    MeasureType: "Base",
    Month: "0",
    OpponentTeamID: "0",
    Outcome: "",
    PORound: "0",
    PaceAdjust: "N",
    PerMode: "Totals",
    Period: "0",
    PlayerExperience: "",
    PlayerPosition: "",
    PlusMinus: "N",
    Rank: "N",
    Season: String(season),
    SeasonSegment: "",
    SeasonType: REGULAR_SEASON,
    ShotClockRange: "",
    StarterBench: "",
    TeamID: "0",
    VsConference: "",
    VsDivision: "",
    Weight: "",
  })}`;

/**
 * Where the store keeps a player's numbers for a season.
 * @param {number} season
 * @param {string} id
 */
export const nameNumbersKey = (season, id) => `players/${season}-${id}`;

/**
 * Where the store keeps a season's ranked numbers, which it writes once the season's players and
 * rosters are saved.
 * @param {number} season
 */
export const nameRanksKey = (season) => `ranks/${season}`;

/**
 * The most games any team has played, which the rule's share of a season counts from.
 * @param {Record<string, any>[]} teamGames
 */
function countSeasonGames(teamGames) {
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const game of teamGames) counts.set(game.TEAM_ID, (counts.get(game.TEAM_ID) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

/**
 * What the rule asks for this far into a season.
 * @param {number} seasonGames
 * @param {number} needed over a whole season
 */
const prorate = (seasonGames, needed) => Math.ceil((needed * seasonGames) / FULL_SEASON_GAMES);

/**
 * Whether a player's totals reach the season's total that ranks her in a stat short of the games.
 * @param {NumericTotals} row
 * @param {RankedStat} stat
 * @param {number} seasonGames
 */
const hasCount = (row, stat, seasonGames) =>
  stat.count != null && stat.needed != null && stat.count(row) >= prorate(seasonGames, stat.needed);

/**
 * Whether a player's totals meet the rule for a stat.
 * @param {NumericTotals} row
 * @param {RankedStat} stat
 * @param {number} seasonGames
 */
function meetsRule(row, stat, seasonGames) {
  if (stat.isShare) return hasCount(row, stat, seasonGames);
  return hasCount(row, stat, seasonGames) || row.GP >= prorate(seasonGames, LEADER_GAMES);
}

/**
 * How far into the season it is, and each ranked stat's numbers among the players who meet the
 * rule for it, from the lowest.
 * @typedef {import("../../../../../shared/worker/sports-schema.js").BasketballRanksRecord} Ranks
 */

/**
 * @param {any} totals every player's totals in the regular season
 * @param {any} teamGames every team's games in it
 * @returns {Ranks}
 */
export function describeRanks(totals, teamGames) {
  validatePlayerFeed(totals, "LeagueDashPlayerStats");
  validatePlayerFeed(teamGames, "LeagueGameLog");
  const everyone = readTable(totals, "LeagueDashPlayerStats");
  const seasonGames = countSeasonGames(readTable(teamGames, "LeagueGameLog"));
  /** @param {RankedStat} stat */
  const listValues = (stat) =>
    everyone
      .filter((row) => meetsRule(row, stat, seasonGames))
      .map(stat.read)
      .filter((value) => value != null)
      .sort((first, second) => first - second);
  return validateSportsData(BasketballRanks, {
    seasonGames,
    values: /** @type {Ranks["values"]} */ (
      Object.fromEntries(RANKED_STATS.map((stat) => [stat.key, listValues(stat)]))
    ),
  });
}

// The page draws the spread a few dozen points wide, so four places are plenty.
/** @param {number} value */
const roundForCurve = (value) => Math.round(value * 10000) / 10000;

/**
 * How many ranked numbers beat hers: the higher ones, or the lower for a stat the fewest leads.
 * @param {number[]} values
 * @param {number} value
 * @param {RankedStat} stat
 */
const countAhead = (values, value, stat) =>
  stat.isFewestFirst
    ? values.filter((each) => each < value - SAME_NUMBER).length
    : values.filter((each) => each > value + SAME_NUMBER).length;

/**
 * How far she is toward the rule for a stat, as a share of what it asks this far into the season,
 * to two places: of the games or the season's total, whichever she's nearer, or for a percentage
 * of the shots made.
 * @param {NumericTotals} her
 * @param {RankedStat} stat
 * @param {number} seasonGames
 */
function measureProgress(her, stat, seasonGames) {
  const countShare =
    stat.count != null && stat.needed != null
      ? stat.count(her) / prorate(seasonGames, stat.needed)
      : 0;
  const gamesShare = stat.isShare ? 0 : her.GP / prorate(seasonGames, LEADER_GAMES);
  return Math.floor(Math.max(countShare, gamesShare) * 100) / 100;
}

/**
 * Her number in a stat, and, among the players who meet the rule, her place and every number, from
 * the lowest, for the page to draw how they spread, with how far she is toward the rule.
 * @param {NumericTotals} her
 * @param {Ranks} ranks
 * @param {RankedStat} stat
 */
function rankStat(her, ranks, stat) {
  const value = stat.read(her);
  const values = ranks.values[stat.key] ?? [];
  const isRanked = value != null && meetsRule(her, stat, ranks.seasonGames);
  const rank = isRanked ? 1 + countAhead(values, value, stat) : null;
  return {
    key: stat.key,
    value,
    rank,
    count: values.length,
    values: values.map(roundForCurve),
    progress: measureProgress(her, stat, ranks.seasonGames),
  };
}

/**
 * Whether her totals have a stat: a per-game stat is missing only from totals saved before the
 * store kept its column, while a percentage she took no shots for is kept, shown with no number.
 * @param {NumericTotals} her
 * @param {RankedStat} stat
 */
const hasStat = (her, stat) => !!stat.isShare || stat.read(her) != null;

/**
 * Her regular season: her games, her averages, and her place in each ranked stat, or null before
 * she has played.
 * @param {NumericTotals | null} her her totals in the regular season
 * @param {Ranks} ranks
 */
export function describeRegularSeason(her, ranks) {
  if (!her || !(her.GP > 0)) return null;
  return {
    games: her.GP,
    gamesNeeded: prorate(ranks.seasonGames, LEADER_GAMES),
    averages: averageTotals(her),
    stats: RANKED_STATS.filter((stat) => hasStat(her, stat)).map((stat) =>
      rankStat(her, ranks, stat),
    ),
  };
}

/**
 * Her team's score and the other team's in a game, from every team's log, or nulls when the log
 * doesn't have it yet.
 * @param {Record<string, any>} game her row in her game log
 * @param {Record<string, any>[]} teamGames
 */
function readScore(game, teamGames) {
  const row = teamGames.find(
    (each) => each.GAME_ID === game.GAME_ID && each.TEAM_ID === game.TEAM_ID,
  );
  if (!row) return { teamScore: null, opponentScore: null };
  return { teamScore: row.PTS, opponentScore: row.PTS - row.PLUS_MINUS };
}

/**
 * Her line in a game and how it ended.
 * @param {Record<string, any>} game her row in her game log
 * @param {boolean} isPlayoffs
 * @param {Record<string, any>[]} teamGames every team's games of that kind
 */
const describeGame = (game, isPlayoffs, teamGames) => ({
  gameId: game.GAME_ID,
  day: String(game.GAME_DATE).slice(0, 10),
  isPlayoffs,
  isWin: game.WL === "W",
  ...readScore(game, teamGames),
  points: game.PTS,
  rebounds: game.REB,
  assists: game.AST,
  minutes: game.MIN,
  steals: game.STL,
  blocks: game.BLK,
  turnovers: game.TOV,
  fieldGoalsMade: game.FGM,
  fieldGoalsAttempted: game.FGA,
  threesMade: game.FG3M,
  threesAttempted: game.FG3A,
  freeThrowsMade: game.FTM,
  freeThrowsAttempted: game.FTA,
});

/** @param {Record<string, any>[]} games */
const findLatest = (games) =>
  games.reduce(
    (latest, game) => (!latest || game.GAME_DATE > latest.GAME_DATE ? game : latest),
    /** @type {Record<string, any> | null} */ (null),
  );

/**
 * A player's numbers in a season, as the store keeps them: her name as the feeds write it, her
 * regular season's totals, her last game, and her points in each playoff game.
 * @typedef {import("../../../../../shared/worker/sports-schema.js").PlayerNumbersRecord} PlayerNumbers
 */

/**
 * @param {object} rows
 * @param {Record<string, any> | null} rows.totals her row in every player's totals
 * @param {Record<string, any>[]} rows.regularGames her regular season's games
 * @param {Record<string, any>[]} rows.playoffGames her playoff games
 * @param {(isPlayoffs: boolean) => Record<string, any>[]} teamGames every team's games of a kind
 * @returns {PlayerNumbers}
 */
function describePlayerNumbers({ totals, regularGames, playoffGames }, teamGames) {
  const isPlayoffs = playoffGames.length > 0;
  const latest = findLatest(isPlayoffs ? playoffGames : regularGames);
  const named = [...playoffGames, ...regularGames, totals].find((row) => row?.PLAYER_NAME);
  return validateSportsData(BasketballPlayerNumbers, {
    name: named ? splitName(named.PLAYER_NAME) : null,
    totals:
      totals &&
      /** @type {PlayerNumbers["totals"]} */ (
        Object.fromEntries(TOTALS_COLUMNS.map((column) => [column, totals[column]]))
      ),
    lastGame: latest && describeGame(latest, isPlayoffs, teamGames(isPlayoffs)),
    playoffPoints: Object.fromEntries(playoffGames.map((game) => [game.GAME_ID, game.PTS])),
  });
}

/**
 * @param {Record<string, any>[]} rows
 * @returns {Map<string, Record<string, any>[]>}
 */
function groupByPlayer(rows) {
  const groups = new Map();
  for (const row of rows) {
    const id = String(row.PLAYER_ID);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  return groups;
}

/**
 * Every player's numbers in a season and its ranked numbers, from every player's totals and game
 * logs and every team's games.
 * @param {{ totals: any, regularGames: any, playoffGames: any, teamRegularGames: any, teamPlayoffGames: any }} answers
 */
export function describeSeasonPlayers({
  totals,
  regularGames,
  playoffGames,
  teamRegularGames,
  teamPlayoffGames,
}) {
  for (const [answer, table] of [
    [totals, "LeagueDashPlayerStats"],
    [regularGames, "PlayerGameLogs"],
    [playoffGames, "PlayerGameLogs"],
    [teamRegularGames, "LeagueGameLog"],
    [teamPlayoffGames, "LeagueGameLog"],
  ])
    validatePlayerFeed(answer, table);
  const totalsById = new Map(
    readTable(totals, "LeagueDashPlayerStats").map((row) => [String(row.PLAYER_ID), row]),
  );
  const regularById = groupByPlayer(readTable(regularGames, "PlayerGameLogs"));
  const playoffsById = groupByPlayer(readTable(playoffGames, "PlayerGameLogs"));
  const teamGames = {
    regular: readTable(teamRegularGames, "LeagueGameLog"),
    playoffs: readTable(teamPlayoffGames, "LeagueGameLog"),
  };
  const ids = new Set([...totalsById.keys(), ...regularById.keys(), ...playoffsById.keys()]);
  /** @type {Map<string, PlayerNumbers>} */
  const players = new Map();
  for (const id of ids)
    players.set(
      id,
      describePlayerNumbers(
        {
          totals: totalsById.get(id) ?? null,
          regularGames: regularById.get(id) ?? [],
          playoffGames: playoffsById.get(id) ?? [],
        },
        (isPlayoffs) => (isPlayoffs ? teamGames.playoffs : teamGames.regular),
      ),
    );
  return { ranks: describeRanks(totals, teamRegularGames), players };
}

/**
 * What her sheet shows, from her numbers, her team's roster, and the season's ranked numbers, or
 * null when neither her roster nor the feeds have her.
 * @param {object} saved
 * @param {string} saved.id
 * @param {string} saved.team
 * @param {number} saved.season
 * @param {PlayerNumbers | null} saved.numbers
 * @param {{ players: any[] } | null} saved.roster
 * @param {Ranks} saved.ranks
 */
export function composePlayer({ id, team, season, numbers, roster, ranks }) {
  const facts = roster?.players.find((player) => player.id === id) ?? null;
  const names = facts ? { firstName: facts.firstName, lastName: facts.lastName } : numbers?.name;
  if (!names) return null;
  return {
    id,
    team,
    season,
    ...names,
    facts,
    lastGame: numbers?.lastGame ?? null,
    playoffPoints: numbers?.playoffPoints ?? {},
    regularSeason: describeRegularSeason(numbers?.totals ?? null, ranks),
  };
}

/** @param {URLSearchParams} searchParams */
export function readId(searchParams) {
  const id = searchParams.get("id") ?? "";
  return /^\d{1,12}$/.test(id) ? id : null;
}

/**
 * @param {object} options
 * @param {(key: string) => Promise<{ players: any[] }>} options.loadRoster a team's roster for a
 *   season, keyed as NYL:2026
 * @param {(input: string, init: object) => Promise<Response>} [options.fetchImpl]
 * @param {() => number} [options.now]
 */
export function createPlayerReader({
  loadRoster,
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
}) {
  /**
   * @param {string} url
   * @param {number} season
   * @param {string} table
   */
  const readFeed = (url, season, table) =>
    fetchWnbaJson(
      fetchImpl,
      url,
      isCurrentSeason(season, now()) ? CACHE_SECONDS : PAST_CACHE_SECONDS,
      hasTable(table),
    ).then((answer) => validatePlayerFeed(answer, table));

  // Each key is a season, or a season and the kind of games, as 2026:Playoffs.
  const loadTotals = createReusedLoader(
    (/** @type {number} */ season) =>
      readFeed(nameTotalsRequest(season), season, "LeagueDashPlayerStats"),
    REUSE_MS,
    now,
  );
  const loadTeamGames = createReusedLoader(
    (/** @type {string} */ key) => {
      const [season, seasonType] = key.split(":");
      return readFeed(
        nameTeamGameLogRequest(Number(season), seasonType),
        Number(season),
        "LeagueGameLog",
      );
    },
    REUSE_MS,
    now,
  );

  /**
   * @param {string} id
   * @param {number} season
   * @param {string} seasonType
   */
  const readGameLog = async (id, season, seasonType) =>
    readTable(
      await readFeed(nameGameLogRequest(season, seasonType, id), season, "PlayerGameLogs"),
      "PlayerGameLogs",
    );

  /**
   * Her sheet read from the league, for a season the store doesn't keep.
   * @param {{ id: string, team: string, season: number }} asked
   */
  async function readPlayerFromLeague({ id, team, season }) {
    const [roster, regularGames, playoffGames, totals, teamRegularGames] = await Promise.all([
      loadRoster(`${team}:${season}`),
      readGameLog(id, season, REGULAR_SEASON),
      readGameLog(id, season, PLAYOFFS),
      loadTotals(season),
      loadTeamGames(`${season}:${REGULAR_SEASON}`),
    ]);
    const isPlayoffs = playoffGames.length > 0;
    const teamGames = isPlayoffs ? await loadTeamGames(`${season}:${PLAYOFFS}`) : teamRegularGames;
    const her = readTable(totals, "LeagueDashPlayerStats").find(
      (row) => String(row.PLAYER_ID) === id,
    );
    const numbers = describePlayerNumbers({ totals: her ?? null, regularGames, playoffGames }, () =>
      readTable(teamGames, "LeagueGameLog"),
    );
    const ranks = describeRanks(totals, teamRegularGames);
    return composePlayer({ id, team, season, numbers, roster, ranks });
  }

  return readPlayerFromLeague;
}
