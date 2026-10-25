import * as WNBASnapshot from "../../page/js/snapshot.js";
import { readEasternDay } from "#shared/days.js";
import { createFeedKeeper } from "../../../../shared/worker/feed-keeper.js";
import { createReusedLoader, fetchUpstream } from "../../../../shared/worker/upstream.js";
import { createGameEnds } from "./game-ends.js";
import { createEspnGameReader, readEndTime } from "./lead.js";
import { listUpcomingMeetings } from "./preview.js";
import { ESPN_HEADERS, fetchWnbaJson } from "./wnba.js";

const EDGE_CACHE_SECONDS = 5;
// No longer than the wait between updates in a game's closing stretch, so each one reads the league.
const SNAPSHOT_REUSE_MS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;
// The schedule, bracket, and standings change as games end, and otherwise
// hardly at all, and the stats site is slow and quick to turn away a busy caller.
const SLOW_FEEDS = {
  schedule: { maxAgeMs: DAY_MS, changesWithGames: true },
  standings: { maxAgeMs: DAY_MS, changesWithGames: true },
  bracket: { maxAgeMs: DAY_MS, changesWithGames: true },
};

// Where each feed's answer keeps its data.
const FEED_DATA = {
  scoreboard: (answer) => answer?.scoreboard?.games,
  schedule: (answer) => answer?.leagueSchedule?.gameDates,
  bracket: (answer) => answer?.bracket?.playoffBracketSeries,
  standings: (answer) => answer?.resultSets?.[0]?.rowSet,
};

const hasFeedData = (name, answer) => Array.isArray(FEED_DATA[name](answer));

// The players' averages a game, a request the snapshot doesn't read, since the player job reads
// their totals, but whose last answer the slow feeds' storage can still hold until it's forgotten,
// written out as it was read.
/** @param {number} season */
const nameAveragesRequest = (season) =>
  `https://stats.wnba.com/stats/leaguedashplayerstats?College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&GameScope=&GameSegment=&Height=&LastNGames=0&LeagueID=10&Location=&MeasureType=Base&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PaceAdjust=N&PerMode=PerGame&Period=0&PlayerExperience=&PlayerPosition=&PlusMinus=N&Rank=N&Season=${season}&SeasonSegment=&SeasonType=Regular+Season&ShotClockRange=&StarterBench=&TeamID=0&VsConference=&VsDivision=&Weight=`;

// Network listings are reused between normal polls; deadline verification refreshes open months.
const NETWORKS_MS = 6 * 60 * 60 * 1000;

const formatEspnDay = (ms) => readEasternDay(ms).date.replaceAll("-", "");
const formatEspnMonth = (ms) => formatEspnDay(ms).slice(0, 6);

// ESPN's own links are plain http, so they're read over https instead.
const upgradeLink = (link) => String(link).replace(/^http:/, "https:");

const readEventId = (link) => String(link).match(/\/events\/(\d+)/)?.[1] ?? null;

const countFinals = (scoreboard) =>
  (scoreboard?.scoreboard?.games ?? []).filter((game) => game.gameStatus === 3).length;

// Reads the league for the store, and reads moments apart share one trip to it.
/**
 * @param {object} [options]
 * @param {(input: string, init: object) => Promise<Response>} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {import("../../../../shared/worker/feed-keeper.js").FeedStorage} [options.storage]
 */
export function createSnapshotLoader({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
  storage = undefined,
} = {}) {
  const slowFeeds = createFeedKeeper({ feeds: SLOW_FEEDS, leagueName: "The WNBA", now, storage });
  const networkMonths = new Map();
  const espnGames = createEspnGameReader({ fetchImpl });
  const gameEnds = createGameEnds({
    loadEndTime: (game) =>
      espnGames
        .fetchSummary({ away: game.away.team, home: game.home.team, start: game.start })
        .then(readEndTime),
    now,
    storage,
  });

  /**
   * @param {keyof typeof FEED_DATA} name
   * @param {string} url
   */
  const fetchFeed = (name, url) =>
    fetchWnbaJson(fetchImpl, url, EDGE_CACHE_SECONDS, (answer) => hasFeedData(name, answer));

  /**
   * @param {keyof typeof SLOW_FEEDS} name
   * @param {string} url
   * @param {{ isBehind?: (answer: any) => boolean, requireFresh?: boolean }} [options]
   */
  const readSlowFeed = (name, url, options = {}) =>
    slowFeeds.readFeed(name, url, () => fetchFeed(name, url), options);

  async function fetchEspnJson(url) {
    const response = await fetchUpstream(fetchImpl, url, {
      headers: ESPN_HEADERS,
      cacheSeconds: EDGE_CACHE_SECONDS,
    });
    if (!response.ok) throw new Error(`ESPN answered ${response.status}`);
    return response.json();
  }

  async function fetchBackupGame(eventId) {
    const competition = await fetchEspnJson(WNBASnapshot.BACKUP_REQUESTS.competition(eventId));
    const [status, ...scores] = await Promise.all([
      fetchEspnJson(upgradeLink(competition.status.$ref)),
      ...competition.competitors.map((competitor) =>
        fetchEspnJson(upgradeLink(competitor.score.$ref)),
      ),
    ]);
    return { competition, status, scores };
  }

  // Yesterday's games too, since a late game is still being played after midnight Eastern. A game
  // ESPN didn't answer for is left out, so it doesn't keep the others from standing in.
  async function fetchBackup() {
    const request = WNBASnapshot.BACKUP_REQUESTS.events(
      formatEspnDay(now() - DAY_MS),
      formatEspnDay(now()),
    );
    const listing = await fetchEspnJson(request);
    const eventIds = (listing.items ?? []).map((item) => readEventId(item.$ref)).filter(Boolean);
    const games = await Promise.all(eventIds.map((id) => fetchBackupGame(id).catch(() => null)));
    return { games: games.filter(Boolean) };
  }

  // A month's answer from after the month ended is final, so it's kept for good. Any other month is
  // read again now and then, and a read that fails waits as long as one that answers, with the
  // last good answer standing in meanwhile.
  /**
   * @param {{ answeredAt: number | null }} kept
   * @param {string} month
   */
  const isFinalAnswer = (kept, month) =>
    kept.answeredAt !== null && formatEspnMonth(kept.answeredAt) > month;

  /** @param {string} month */
  function isDueForNetworksRead(month) {
    const kept = networkMonths.get(month);
    if (!kept) return true;
    if (isFinalAnswer(kept, month)) return false;
    return now() - kept.readAt >= NETWORKS_MS;
  }

  /** @param {string} month @param {boolean} [verify] */
  async function readNetworkMonth(month, verify = false) {
    const kept = networkMonths.get(month);
    if (!isDueForNetworksRead(month) && (!verify || isFinalAnswer(kept, month))) return kept.data;
    try {
      const data = await fetchEspnJson(WNBASnapshot.NETWORKS_REQUEST(month));
      networkMonths.set(month, { readAt: now(), answeredAt: now(), data });
      return data;
    } catch {
      const answeredAt = kept?.answeredAt ?? null;
      const data = kept?.data ?? null;
      networkMonths.set(month, { readAt: now(), answeredAt, data });
      return data;
    }
  }

  // Each month with a playoff game or a team's nearest game, and yesterday's and today's, since a
  // late game is still being played after midnight Eastern, and the schedule may not have answered.
  function listNetworkMonths(schedule, season) {
    const starts = WNBASnapshot.listScheduledStarts(schedule, season).map(Date.parse);
    const times = [now() - DAY_MS, now(), ...starts].filter(Number.isFinite);
    return [...new Set(times.map(formatEspnMonth))].sort();
  }

  async function readNetworks(schedule, season, verify = false) {
    const months = listNetworkMonths(schedule, season);
    const answers = await Promise.all(months.map((month) => readNetworkMonth(month, verify)));
    return answers.filter(Boolean);
  }

  async function fetchResponses(season, verify = false) {
    await slowFeeds.forgetFeed("players", nameAveragesRequest(season));
    const scoreboard = await fetchFeed("scoreboard", WNBASnapshot.REQUESTS.scoreboard).catch(
      () => null,
    );
    await slowFeeds.noteFinalCount(scoreboard ? countFinals(scoreboard) : null);
    const hasGamesLeftLive = (schedule) =>
      WNBASnapshot.listGamesLeftLive(schedule, scoreboard, season).size > 0;
    const [schedule, bracket, standings] = await Promise.all([
      readSlowFeed("schedule", WNBASnapshot.REQUESTS.schedule, {
        isBehind: hasGamesLeftLive,
        requireFresh: verify,
      }).catch(() => null),
      readSlowFeed("bracket", WNBASnapshot.REQUESTS.bracket(season), {
        requireFresh: verify,
      }).catch(() => null),
      readSlowFeed("standings", WNBASnapshot.REQUESTS.standings(season)).catch(() => null),
    ]);
    if (!scoreboard && !schedule && !bracket)
      throw new Error("None of the WNBA's feeds answered with data");
    const needsBackup = !scoreboard || hasGamesLeftLive(schedule);
    const [backup, networks] = await Promise.all([
      needsBackup ? fetchBackup().catch(() => null) : null,
      readNetworks(schedule, season, verify),
    ]);
    return { scoreboard, schedule, bracket, standings, backup, networks };
  }

  /**
   * @param {number} season
   * @param {number} requestedAt
   * @param {boolean} [verify]
   */
  async function fetchSnapshot(season, requestedAt, verify = false) {
    const responses = await fetchResponses(season, verify);
    const snapshot = WNBASnapshot.buildSnapshot(responses, { season, now: requestedAt });
    const ended = await addGameEnds(snapshot);
    return {
      ...ended,
      meetings: listUpcomingMeetings(responses.schedule, ended),
    };
  }

  // A game can be both a playoff game and a team's nearest, and is looked up once.
  /**
   * @template {{ games: any[], nearestGames: any[] }} Snapshot
   * @param {Snapshot} snapshot
   * @returns {Promise<Snapshot>}
   */
  async function addGameEnds(snapshot) {
    const games = [...new Set([...snapshot.games, ...snapshot.nearestGames])];
    const endedById = new Map((await gameEnds.addEnds(games)).map((game) => [game.id, game]));
    const readEnded = (game) => endedById.get(game.id) ?? game;
    return {
      ...snapshot,
      games: snapshot.games.map(readEnded),
      nearestGames: snapshot.nearestGames.map(readEnded),
    };
  }

  const loadReusedSnapshot = createReusedLoader(fetchSnapshot, SNAPSHOT_REUSE_MS, now);
  const loadSnapshot = (season, { verify = false } = {}) =>
    verify ? fetchSnapshot(season, now(), true) : loadReusedSnapshot(season);

  return { loadSnapshot };
}
