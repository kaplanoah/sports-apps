import { isSameJson } from "#shared/compare.js";
import {
  createPerStoreJob,
  createSavedDocs,
  listPastSeasons,
} from "../../../../shared/worker/background-job.js";
import { createFeedKeeper } from "../../../../shared/worker/feed-keeper.js";
import { catchFailure, noteFailure, runWithStatus } from "../../../../shared/worker/job-status.js";
import { nameCountKey, LEAGUE_READS_COUNT } from "../../../../shared/worker/season-store.js";
import { nameScheduleKey } from "../../page/js/snapshot.js";
import { isStillPlaying } from "../../page/js/series.js";
import { TEAMS } from "../../page/js/teams.js";
import {
  GAME_LOG_COLUMNS,
  PLAYOFFS,
  REGULAR_SEASON,
  TEAM_GAME_COLUMNS,
  TOTALS_FEED_COLUMNS,
  describeSeasonPlayers,
  nameGameLogRequest,
  nameNumbersKey,
  nameRanksKey,
  nameTeamGameLogRequest,
  nameTotalsRequest,
} from "./adapters/player.js";
import { fetchInjuries, listOutPlayers } from "./injuries.js";
import { namePlayerIndexKey } from "#shared/page-search.js";
import { nameOvertimesKey } from "../../page/js/search-pages.js";
import { describeOvertimes } from "./overtimes.js";
import { describeAveragesDoc, listLeaders, nameAveragesKey } from "./season-averages.js";
import { nameSeasonKey } from "./season-updater.js";
import { indexRosters } from "./player-index.js";
import {
  describeRoster,
  nameLeagueRosterRequest,
  namePlayerListRequest,
  nameRosterKey,
} from "./adapters/roster.js";
import { fetchWnbaJson, hasTable, trimColumns } from "./wnba.js";

// Keeps what player and roster sheets show, and the list of players search finds, so a tap reads
// only the store and never waits on the league. Each run reads only the feeds that may have
// changed: every player's totals and game logs and every team's games as a game ends, each team's
// roster every few hours, the league's list of every player once a day, and ESPN's injury report,
// once for the whole league, every hour while a team still plays. It keeps each feed trimmed to the
// columns the sheets read, and saves only the documents that changed: each team's roster, each
// player's numbers, and the season's ranked numbers, which go after them, so a season that has them
// is whole, every player's averages, for her team's Roster, and with them each team's leading
// scorers in the season's record, from the totals her sheet is worked out from, the finals that
// went to overtime, for search, and, once every team's roster has answered, the season's list of
// players. Live runs report in `players/status`, including how often a sheet needed a league read.
// A separate historical run fills one past season at a time, newest first, and reports its active
// work in `players-history/status`. Completed seasons are read again only when required columns change.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const RUN_DELAY_MS = 5 * MINUTE_MS;
const STATUS_KEY = "players/status";
export const PLAYER_JOB = "players";
const TEAM_KEYS = Object.keys(TEAMS);

const FEEDS = {
  totals: { maxAgeMs: 6 * HOUR_MS, changesWithGames: true },
  playerGames: { maxAgeMs: 6 * HOUR_MS, changesWithGames: true },
  teamGames: { maxAgeMs: 6 * HOUR_MS, changesWithGames: true },
  roster: { maxAgeMs: 6 * HOUR_MS, changesWithGames: false },
  playerList: { maxAgeMs: 24 * HOUR_MS, changesWithGames: false },
  out: { maxAgeMs: HOUR_MS, changesWithGames: false },
};

const ROSTER_COLUMNS = [
  "PLAYER_ID",
  "PLAYER",
  "NUM",
  "POSITION",
  "HEIGHT",
  "BIRTH_DATE",
  "COACH_TYPE",
  "COACH_NAME",
];
const PLAYER_LIST_COLUMNS = [
  "PERSON_ID",
  "PLAYER_FIRST_NAME",
  "PLAYER_LAST_NAME",
  "COLLEGE",
  "COUNTRY",
  "FROM_YEAR",
];

// A team no one reads ESPN for, or whose report didn't answer, has no one out.
/** @type {import("./injuries.js").OutPlayer[]} */
const NO_ONE_OUT = [];
/** @type {Record<string, import("./injuries.js").OutPlayer[]>} */
const NO_TEAM_OUT = {};

/** @typedef {import("../../../../shared/worker/season-store.js").JobContext} JobContext */
/**
 * What a run did, for its status: how many times it read each feed, how many documents it saved
 * in each collection, and the past season it filled.
 * @typedef {object} RunLog
 * @property {Record<string, number>} feeds
 * @property {Record<string, number>} saved
 * @property {{ season: number, isWhole: boolean } | null} pastSeason
 */
/** @typedef {import("../../../../shared/worker/job-status.js").RunContext & { log: RunLog }} RunContext */

/** @returns {RunLog} */
const createRunLog = () => ({ feeds: {}, saved: {}, pastSeason: null });

/**
 * @param {Record<string, number>} counts
 * @param {string} name
 */
const addOne = (counts, name) => {
  counts[name] = (counts[name] ?? 0) + 1;
};

/** @param {number} season */
const nameFilledKey = (season) => `filled:${season}`;
// What a filled season was kept with, its columns and the documents saved from them, so one
// filled with fewer is filled again.
const FILLED_WITH = [
  ...new Set([...TOTALS_FEED_COLUMNS, ...GAME_LOG_COLUMNS, ...TEAM_GAME_COLUMNS]),
  "averages",
].join(" ");
// Says every past season was filled with these, and has its list of players, while this one was
// current, so a run lists the store's seasons again only once the store moves on, which makes the
// current season a past one, or the sheets come to read more.
const ALL_FILLED_KEY = "allFilled";
/** @param {number} current */
const describeAllFilled = (current) => `${current} ${FILLED_WITH} player-index`;

/**
 * How many of a season's games, regular season and playoffs, the store has seen end.
 * @param {any} schedule the season's schedule as the store keeps it
 */
const countFinals = (schedule) =>
  Array.isArray(schedule?.games)
    ? schedule.games.filter((/** @type {any} */ game) => game.state === "final").length
    : null;

// Each season's totals as they were kept without each player's team, under a key no run reads,
// written out as they were kept, since a change to how the totals are read now can't change it.
/** @param {number} season */
const nameOldTotalsRequest = (season) =>
  `https://stats.wnba.com/stats/leaguedashplayerstats?College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&GameScope=&GameSegment=&Height=&LastNGames=0&LeagueID=10&Location=&MeasureType=Base&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PaceAdjust=N&PerMode=Totals&Period=0&PlayerExperience=&PlayerPosition=&PlusMinus=N&Rank=N&Season=${season}&SeasonSegment=&SeasonType=Regular+Season&ShotClockRange=&StarterBench=&TeamID=0&VsConference=&VsDivision=&Weight= PLAYER_ID PLAYER_NAME GP MIN PTS REB AST STL BLK TOV FGM FGA FG3M FG3A FTM FTA`;

/** One store's update, with what it keeps between runs while it stays in memory. */
function createStoreUpdate(historyOnly = false) {
  /** @type {ReturnType<typeof createFeedKeeper> | null} */
  let keeper = null;
  const savedDocs = createSavedDocs();

  /**
   * @param {RunContext} context
   * @param {string} key
   * @param {any} doc
   */
  async function saveDoc({ docs, log }, key, doc) {
    if (await savedDocs.saveDoc(docs, key, doc)) addOne(log.saved, key.split("/")[0]);
  }

  /**
   * Reads a feed trimmed to its columns, kept under them, so one kept with fewer is read again.
   * @param {RunContext} context
   * @param {string} name which feed's limits apply
   * @param {string} url
   * @param {string} table
   * @param {string[]} columns
   */
  const readStats = (context, name, url, table, columns) =>
    /** @type {ReturnType<typeof createFeedKeeper>} */ (keeper).readFeed(
      name,
      `${url} ${columns.join(" ")}`,
      async () => {
        addOne(context.log.feeds, name);
        return trimColumns(
          await fetchWnbaJson(context.fetchImpl, url, null, hasTable(table)),
          columns,
        );
      },
    );

  /**
   * Who ESPN lists as out on each team today, and why, or no one when ESPN hasn't answered.
   * @param {RunContext} context
   */
  const readOutPlayers = (context) =>
    /** @type {ReturnType<typeof createFeedKeeper>} */ (keeper)
      .readFeed("out", "league", async () => {
        addOne(context.log.feeds, "out");
        return listOutPlayers(await fetchInjuries(context.fetchImpl, null));
      })
      .catch(() => NO_TEAM_OUT);

  /** @param {number} season */
  const forgetOldTotals = (season) =>
    /** @type {ReturnType<typeof createFeedKeeper>} */ (keeper).forgetFeed(
      "totals",
      nameOldTotalsRequest(season),
    );

  /**
   * @param {RunContext} context
   * @param {number} season
   */
  async function readSeasonFeeds(context, season) {
    await forgetOldTotals(season);
    return Promise.all([
      readStats(
        context,
        "totals",
        nameTotalsRequest(season),
        "LeagueDashPlayerStats",
        TOTALS_FEED_COLUMNS,
      ),
      ...[REGULAR_SEASON, PLAYOFFS].map((seasonType) =>
        readStats(
          context,
          "playerGames",
          nameGameLogRequest(season, seasonType),
          "PlayerGameLogs",
          GAME_LOG_COLUMNS,
        ),
      ),
      ...[REGULAR_SEASON, PLAYOFFS].map((seasonType) =>
        readStats(
          context,
          "teamGames",
          nameTeamGameLogRequest(season, seasonType),
          "LeagueGameLog",
          TEAM_GAME_COLUMNS,
        ),
      ),
    ]);
  }

  /**
   * Each team's roster answer, or null for one the league hasn't answered.
   * @param {RunContext} context
   * @param {number} season
   */
  const readRosterFeeds = (context, season) =>
    Promise.all(
      TEAM_KEYS.map((team) =>
        readStats(
          context,
          "roster",
          nameLeagueRosterRequest(team, season),
          "CommonTeamRoster",
          ROSTER_COLUMNS,
        ).catch(() => null),
      ),
    );

  /**
   * Who is out on each team, kept only for a team that still plays this season, since a page shows
   * it only then, and read only while one does.
   * @param {RunContext} context
   * @param {any[] | null} series the season's series, or null for a past season
   */
  async function readOutFeeds(context, series) {
    const playing = TEAM_KEYS.map((team) => !!series && isStillPlaying(series, team));
    const byTeam = playing.some(Boolean) ? await readOutPlayers(context) : NO_TEAM_OUT;
    return TEAM_KEYS.map((team, index) =>
      playing[index] ? (byTeam[team] ?? NO_ONE_OUT) : NO_ONE_OUT,
    );
  }

  /**
   * @param {RunContext} context
   * @param {number} season
   * @param {{ leagueRosters: any[], outPlayers: import("./injuries.js").OutPlayer[][], playerList: any }} answers
   * @returns {Promise<ReturnType<typeof describeRoster>[]>} the rosters of the teams the league answered for
   */
  async function saveRosters(context, season, { leagueRosters, outPlayers, playerList }) {
    const rosters = [];
    for (const [index, team] of TEAM_KEYS.entries()) {
      const leagueRoster = leagueRosters[index];
      if (!leagueRoster) continue;
      const roster = describeRoster({
        team,
        season,
        leagueRoster,
        playerList,
        outPlayers: outPlayers[index],
        now: context.now(),
      });
      await saveDoc(context, nameRosterKey(season, team), roster);
      rosters.push(roster);
    }
    return rosters;
  }

  /**
   * Each team's leading scorers, into the season's record, from the averages its Roster shows, so
   * the two change together. A season the store keeps no record of yet gets them in the first run
   * after it does.
   * @param {RunContext} context
   * @param {number} season
   * @param {import("./season-averages.js").PlayerAverages[]} averages
   */
  async function saveLeaders({ docs, log }, season, averages) {
    const leaders = listLeaders(averages);
    let isChanged = false;
    await docs.update(nameSeasonKey(season), (/** @type {any} */ record) => {
      isChanged = !!record && !isSameJson(record.leaders, leaders);
      return isChanged ? { ...record, leaders } : null;
    });
    if (isChanged) addOne(log.saved, "seasons");
  }

  /**
   * @param {RunContext} context
   * @param {number} season
   * @param {any[]} answers
   */
  async function savePlayers(context, season, answers) {
    const [totals, regularGames, playoffGames, teamRegularGames, teamPlayoffGames] = answers;
    const { ranks, players } = describeSeasonPlayers({
      totals,
      regularGames,
      playoffGames,
      teamRegularGames,
      teamPlayoffGames,
    });
    for (const [id, numbers] of players)
      await saveDoc(context, nameNumbersKey(season, id), numbers);
    await saveDoc(context, nameRanksKey(season), ranks);
    const averages = describeAveragesDoc(season, totals);
    await saveDoc(context, nameAveragesKey(season), averages);
    await saveLeaders(context, season, averages.players);
    await saveDoc(
      context,
      nameOvertimesKey(season),
      describeOvertimes(season, [teamRegularGames, teamPlayoffGames]),
    );
  }

  /**
   * Saves a season's rosters, and its numbers once its stats feeds have answered, and says whether
   * every feed answered. A feed that doesn't answer leaves what it feeds as it was saved.
   * @param {RunContext} context
   * @param {number} season
   * @param {any[] | null} series the season's series, or null for a past season
   */
  async function updateSeason(context, season, series) {
    const [stats, leagueRosters, outPlayers, playerList] = await Promise.all([
      readSeasonFeeds(context, season).catch((error) => {
        noteFailure(context.failures, `Reading ${season}'s stats`, error);
        return null;
      }),
      readRosterFeeds(context, season),
      readOutFeeds(context, series),
      readStats(
        context,
        "playerList",
        namePlayerListRequest(season),
        "PlayerIndex",
        PLAYER_LIST_COLUMNS,
      ).catch(() => null),
    ]);
    const rosters = await saveRosters(context, season, { leagueRosters, outPlayers, playerList });
    if (stats) await savePlayers(context, season, stats);
    const hasEveryRoster = leagueRosters.every(Boolean);
    if (hasEveryRoster)
      await saveDoc(context, namePlayerIndexKey(season), indexRosters(season, rosters));
    return !!stats && !!playerList && hasEveryRoster;
  }

  /**
   * Saves a filled season's list of players from the rosters the store keeps, when it has none, so
   * a season filled before the store kept the list gets one without reading the league again.
   * @param {RunContext} context
   * @param {number} season
   */
  async function indexKeptRosters(context, season) {
    if (await context.docs.read(namePlayerIndexKey(season))) return;
    const rosters = await Promise.all(
      TEAM_KEYS.map((team) => context.docs.read(nameRosterKey(season, team))),
    );
    if (rosters.every(Boolean))
      await saveDoc(context, namePlayerIndexKey(season), indexRosters(season, rosters));
  }

  /**
   * Fills the newest past season the store keeps that it hasn't filled.
   * @param {RunContext} context
   * @param {number} current
   */
  async function fillPastSeason(context, current) {
    const allFilled = describeAllFilled(current);
    if ((await context.storage.get(ALL_FILLED_KEY)) === allFilled) return;
    for (const season of await listPastSeasons(context.docs, current)) {
      if ((await context.storage.get(nameFilledKey(season))) === FILLED_WITH) {
        await indexKeptRosters(context, season);
        continue;
      }
      const isWhole = await updateSeason(context, season, null);
      context.log.pastSeason = { season, isWhole };
      if (isWhole) await context.storage.put(nameFilledKey(season), FILLED_WITH);
      return;
    }
    await context.storage.put(ALL_FILLED_KEY, allFilled);
  }

  /** @param {RunContext} context */
  async function keepPlayers(context) {
    keeper ??= createFeedKeeper({
      feeds: historyOnly
        ? Object.fromEntries(
            Object.entries(FEEDS).map(([name, feed]) => [
              name,
              { ...feed, maxAgeMs: Infinity, changesWithGames: false },
            ]),
          )
        : FEEDS,
      now: context.now,
      storage: context.storage,
    });
    const current = (await context.docs.read("live/current"))?.season;
    if (!Number.isInteger(current)) return;
    if (historyOnly) {
      await fillPastSeason(context, current);
      return;
    }
    const savedSeason = await context.docs.read(nameSeasonKey(current));
    await keeper.noteFinalCount(countFinals(await context.docs.read(nameScheduleKey(current))));
    await catchFailure(context.failures, `Keeping ${current}'s players`, () =>
      updateSeason(context, current, savedSeason?.series ?? []),
    );
  }

  /** @param {JobContext} context */
  function updateStore(context) {
    const log = createRunLog();
    return runWithStatus(context, {
      onlyWhenActive: historyOnly,
      statusKey: historyOnly ? "players-history/status" : STATUS_KEY,
      updateStore: (runContext) => keepPlayers({ ...runContext, log }),
      describeRun: async ({ storage }) => ({
        feeds: log.feeds,
        saved: log.saved,
        ...(historyOnly
          ? { pastSeason: log.pastSeason }
          : { leagueReads: (await storage.get(nameCountKey(LEAGUE_READS_COUNT))) ?? 0 }),
      }),
    });
  }

  return updateStore;
}

export function createPlayerJob() {
  const live = createPerStoreJob(RUN_DELAY_MS, createStoreUpdate);
  const history = createPerStoreJob(RUN_DELAY_MS, () => createStoreUpdate(true));
  return { ...live, updateHistory: history.updateStore };
}
