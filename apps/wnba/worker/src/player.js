import { describeError, respondJson } from "../../../../shared/worker/responses.js";
import { noteLeagueRead } from "../../../../shared/worker/store-reads.js";
import { createReusedLoader } from "../../../../shared/worker/upstream.js";
import { nameRosterKey, readTeam } from "./roster.js";
import { SEASON_PARAM, fetchWnbaJson, hasTable, isCurrentSeason, readTable } from "./wnba.js";

// What a player's sheet shows for a season: her facts from her team's roster that season, her last
// game and her points in each playoff game from her game logs, with the score from the league's log
// of every team's games, and, from every player's totals in the regular season, her averages and
// where each ranks among the players who meet the WNBA's rule for its leaders. The store keeps each
// season's numbers (player-updater.js), so a sheet reads the league itself only for a season the
// store doesn't keep, and the store counts each time it does, which shows whether that read is
// still needed.

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
 * @typedef {object} RankedStat
 * @property {string} key what the page calls it
 * @property {(row: Record<string, number>) => number | null} read her number, from her totals
 * @property {(row: Record<string, number>) => number} [count] what the rule counts, from her
 *   totals, for a stat a season's total ranks her in short of the games
 * @property {number} [needed] how many of it the rule asks for over a whole season
 * @property {boolean} [isShare] whether the rule counts only what she counts, not her games
 * @property {boolean} [isFewestFirst] whether the fewest ranks first, as turnovers do
 */

/**
 * @param {string} total
 * @returns {(row: Record<string, number>) => number | null}
 */
const readPerGame = (total) => (row) =>
  row.GP > 0 && row[total] != null ? row[total] / row.GP : null;

/**
 * @param {string} made
 * @param {string} attempted
 * @returns {(row: Record<string, number>) => number | null}
 */
const readShare = (made, attempted) => (row) =>
  row[attempted] > 0 ? row[made] / row[attempted] : null;

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
    SeasonType: "Regular Season",
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

// The feeds write a player's name whole; everything after the first space is her last name.
/** @param {string} name */
function splitName(name) {
  const [firstName, ...rest] = String(name).split(" ");
  return { firstName, lastName: rest.join(" ") };
}

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
 * @param {Record<string, number>} row
 * @param {RankedStat} stat
 * @param {number} seasonGames
 */
const hasCount = (row, stat, seasonGames) =>
  stat.count != null && stat.needed != null && stat.count(row) >= prorate(seasonGames, stat.needed);

/**
 * Whether a player's totals meet the rule for a stat.
 * @param {Record<string, number>} row
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
 * @typedef {{ seasonGames: number, values: Record<string, number[]> }} Ranks
 */

/**
 * @param {any} totals every player's totals in the regular season
 * @param {any} teamGames every team's games in it
 * @returns {Ranks}
 */
export function describeRanks(totals, teamGames) {
  const everyone = readTable(totals, "LeagueDashPlayerStats");
  const seasonGames = countSeasonGames(readTable(teamGames, "LeagueGameLog"));
  /** @param {RankedStat} stat */
  const listValues = (stat) =>
    everyone
      .filter((row) => meetsRule(row, stat, seasonGames))
      .map(stat.read)
      .filter((value) => value != null)
      .sort((first, second) => first - second);
  return {
    seasonGames,
    values: Object.fromEntries(RANKED_STATS.map((stat) => [stat.key, listValues(stat)])),
  };
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
 * @param {Record<string, number>} her
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
 * @param {Record<string, number>} her
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
 * @param {Record<string, number>} her
 * @param {RankedStat} stat
 */
const hasStat = (her, stat) => !!stat.isShare || stat.read(her) != null;

/**
 * Her regular season: her games, her averages, and her place in each ranked stat, or null before
 * she has played.
 * @param {Record<string, number> | null} her her totals in the regular season
 * @param {Ranks} ranks
 */
export function describeRegularSeason(her, ranks) {
  if (!her || !(her.GP > 0)) return null;
  return {
    games: her.GP,
    gamesNeeded: prorate(ranks.seasonGames, LEADER_GAMES),
    averages: {
      points: her.PTS / her.GP,
      rebounds: her.REB / her.GP,
      assists: her.AST / her.GP,
      minutes: her.MIN / her.GP,
    },
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
 * @typedef {object} PlayerNumbers
 * @property {{ firstName: string, lastName: string } | null} name
 * @property {Record<string, number> | null} totals
 * @property {ReturnType<typeof describeGame> | null} lastGame
 * @property {Record<string, number>} playoffPoints
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
  return {
    name: named ? splitName(named.PLAYER_NAME) : null,
    totals: totals && Object.fromEntries(TOTALS_COLUMNS.map((column) => [column, totals[column]])),
    lastGame: latest && describeGame(latest, isPlayoffs, teamGames(isPlayoffs)),
    playoffPoints: Object.fromEntries(playoffGames.map((game) => [game.GAME_ID, game.PTS])),
  };
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
function composePlayer({ id, team, season, numbers, roster, ranks }) {
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
function readId(searchParams) {
  const id = searchParams.get("id") ?? "";
  return /^\d{1,12}$/.test(id) ? id : null;
}

/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

/**
 * @param {object} options
 * @param {(key: string) => Promise<{ players: any[] }>} options.loadRoster a team's roster for a
 *   season, keyed as NYL:2026
 * @param {(input: string, init: object) => Promise<Response>} [options.fetchImpl]
 * @param {() => number} [options.now]
 */
export function createPlayerServer({
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
    );

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

  /**
   * Her sheet from what the store keeps, undefined when it doesn't keep the season, or can't be
   * read, and whether the season is the store's current one.
   * @param {{ id: string, team: string, season: number }} asked
   * @param {ReadDoc} readDoc
   */
  async function readPlayerFromStore({ id, team, season }, readDoc) {
    try {
      const [ranks, numbers, roster, current] = await Promise.all([
        readDoc(nameRanksKey(season)),
        readDoc(nameNumbersKey(season, id)),
        readDoc(nameRosterKey(season, team)),
        readDoc("live/current"),
      ]);
      return {
        player: ranks ? composePlayer({ id, team, season, numbers, roster, ranks }) : undefined,
        isCurrentSeason: season === current?.season,
      };
    } catch (error) {
      console.error(`Reading player ${id} from the store failed: ${describeError(error)}`);
      return { player: undefined, isCurrentSeason: false };
    }
  }

  /**
   * Her sheet from the store, or from the league for a season the store hasn't saved, counted when
   * the season is the store's current one, which the store keeps as it goes.
   * @param {{ id: string, team: string, season: number }} asked
   * @param {ReadDoc} [readDoc]
   * @param {() => Promise<void>} [countLeagueRead]
   */
  async function readPlayer(asked, readDoc, countLeagueRead) {
    if (!readDoc) return readPlayerFromLeague(asked);
    const saved = await readPlayerFromStore(asked, readDoc);
    if (saved.player !== undefined) return saved.player;
    const [player] = await Promise.all([
      readPlayerFromLeague(asked),
      saved.isCurrentSeason && countLeagueRead && noteLeagueRead("a player", countLeagueRead),
    ]);
    return player;
  }

  /**
   * @param {URL} url
   * @param {ReadDoc} [readDoc] the store's documents, when the Worker has a store
   * @param {() => Promise<void>} [countLeagueRead] adds one to the store's count of sheets read
   *   from the league
   */
  async function servePlayer(url, readDoc, countLeagueRead) {
    const id = readId(url.searchParams);
    if (!id) return respondJson({ error: "id must be a player's number in the WNBA's stats" }, 400);
    const team = readTeam(url.searchParams);
    if (!team) return respondJson({ error: "team must name a WNBA team" }, 400);
    const season = SEASON_PARAM.readSeason(url.searchParams, now());
    if (season == null) return respondJson({ error: SEASON_PARAM.rule }, 400);
    try {
      const player = await readPlayer({ id, team, season }, readDoc, countLeagueRead);
      if (!player) return respondJson({ error: `The WNBA has no player ${id} in ${season}` }, 404);
      return respondJson(player);
    } catch (error) {
      return respondJson({ error: `Couldn't read the WNBA: ${describeError(error)}` }, 502);
    }
  }

  return { servePlayer };
}
