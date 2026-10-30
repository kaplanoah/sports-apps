import { nameNetworkMonthKey } from "./network-storage.js";
import { findTeamCodeByEspnId } from "../../page/js/teams.js";
import * as WNBASnapshot from "./adapters/wnba.js";
import { createFeedKeeper, createMemoryStorage } from "../../../../shared/worker/feed-keeper.js";
import { createFeedReadStatus } from "../../../../shared/worker/feed-failures.js";
import { readIdentityGames, trimNetworkAnswer } from "../../../../shared/worker/espn-adapter.js";
import { describeError } from "../../../../shared/worker/responses.js";
import { createReusedLoader } from "../../../../shared/worker/upstream.js";
import { createBackupReader } from "./backup-probe.js";
import { createGameEnds } from "./game-ends.js";
import { createEspnGameReader, readEndTime, listEspnMatches } from "./adapters/lead.js";
import { listUpcomingMeetings } from "./adapters/preview.js";
import { fetchEspnDay, fetchEspnJson, fetchWnbaJson, LIVE_CACHE_SECONDS } from "./wnba.js";

// No longer than the wait between updates in a game's closing stretch, so each one reads the league.
const SNAPSHOT_REUSE_MS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;
// The schedule, bracket, and standings change as games end, and otherwise
// hardly at all, and the stats site is slow and quick to turn away a busy caller.
export const SLOW_FEEDS = {
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

// Broadcast listings rarely change between ordinary season polls.
export const NETWORKS_MS = 6 * 60 * 60 * 1000;
const NETWORKS_EDITION = 1;

const formatEspnMonth = (ms) => WNBASnapshot.formatEspnDay(ms).slice(0, 6);

// The league's feeds, then ESPN's backup scores and channel listings.
const FAILURE_ORDER = [...Object.keys(FEED_DATA), "backup", "networks"];

// In the feeds' own order rather than the order they failed in, so the store's status doesn't
// change while the same feeds fail for the same reasons.
/**
 * Why each feed that didn't answer failed.
 * @param {Record<string, string>} failures
 */
export const describeFailures = (failures) =>
  FAILURE_ORDER.filter((name) => name in failures)
    .map((name) => `${name}: ${failures[name]}`)
    .join("; ");

// ESPN can answer every day and still leave the scoreboard's games uncovered, so while the
// scoreboard is down and a score is due, days on which it neither lists one of the league's games
// ahead of its start nor scores one count as the backup failing.
/**
 * Why ESPN's backup, once it answered, left the scoreboard's games uncovered, or null when it
 * didn't.
 * @param {{ scoreboard: any, backup: import("./backup-probe.js").Backup | null }} responses
 * @param {{ scoreboardCover: string | null, hasScoreDue: boolean }} snapshot
 */
function describeCoverageGap({ scoreboard, backup }, snapshot) {
  if (!backup || scoreboard || snapshot.scoreboardCover || !snapshot.hasScoreDue) return null;
  const total = backup.answers.flatMap((answer) => answer.events ?? []).length;
  return `ESPN gave a score for none of the league's games on ${backup.days.join(" or ")}, of ${total} in all`;
}

const countFinals = (scoreboard) =>
  (scoreboard?.scoreboard?.games ?? []).filter((game) => game.gameStatus === 3).length;

// Reads the league for the store, and reads moments apart share one trip to it.
/**
 * @param {object} [options]
 * @param {(input: string, init: object) => Promise<Response>} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {import("../../../../shared/worker/feed-keeper.js").FeedStorage} [options.storage]
 * @param {import("../../../../shared/worker/store-reads.js").ReadDoc} [options.readDoc]
 */
export function createSnapshotLoader({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
  storage = createMemoryStorage(),
  readDoc = async () => null,
} = {}) {
  const slowFeeds = createFeedKeeper({ feeds: SLOW_FEEDS, now, storage });
  const networkMonths = new Map();
  const espnGames = createEspnGameReader({ fetchImpl });
  const gameEnds = createGameEnds({
    loadEndTime: (game) =>
      espnGames
        .fetchSummary(
          { id: game.id, away: game.away.team, home: game.home.team, start: game.start },
          readDoc,
        )
        .then(readEndTime),
    now,
    storage,
  });

  /**
   * @param {keyof typeof FEED_DATA} name
   * @param {string} url
   * @param {number} season
   */
  const fetchFeed = async (name, url, season) => {
    const answer = await fetchWnbaJson(fetchImpl, url, LIVE_CACHE_SECONDS, (answer) =>
      hasFeedData(name, answer),
    );
    return WNBASnapshot.validateFeedResponse(name, answer, { season });
  };

  /**
   * @param {keyof typeof SLOW_FEEDS} name
   * @param {string} url
   * @param {number} season
   * @param {{ isBehind?: (answer: any) => boolean, readAgain?: boolean, onFailure: (reason: string) => void, onNextRead: (at: number) => void }} options
   */
  const readSlowFeed = (name, url, season, options) =>
    slowFeeds.readFeed(name, url, () => fetchFeed(name, url, season), options);

  /** @param {string} url */
  const fetchEspn = (url) => fetchEspnJson(fetchImpl, url, LIVE_CACHE_SECONDS);

  // Yesterday's games too, since a late game is still being played after midnight Eastern. A day
  // ESPN didn't answer for is left out, so it doesn't keep the other's games from standing in.
  async function fetchBackup() {
    const days = [now() - DAY_MS, now()].map((ms) => WNBASnapshot.formatEspnDay(ms));
    const reads = await Promise.allSettled(
      days.map(async (day) => {
        const answer = await fetchEspnDay(fetchImpl, day);
        WNBASnapshot.validateFeedResponse("backup", answer);
        return answer;
      }),
    );
    const answers = reads.flatMap((read) => (read.status === "fulfilled" ? [read.value] : []));
    const missed = reads.flatMap((read, index) =>
      read.status === "rejected" ? [{ day: days[index], error: read.reason }] : [],
    );
    if (!answers.length) throw missed[0].error;
    return { days, answers, missed };
  }

  const readBackup = createBackupReader({ fetchBackup, now, storage });

  // A current-format answer read after the month ended is final and kept for good. Other answers
  // refresh now and then; a failed read waits just as long, keeping the last good answer.
  /**
   * @param {{ answeredAt: number | null, edition?: number }} kept
   * @param {string} month
   */
  const isFinalAnswer = (kept, month) =>
    kept.edition === NETWORKS_EDITION &&
    kept.answeredAt !== null &&
    formatEspnMonth(kept.answeredAt) > month;

  /** @param {string} month */
  function isDueForNetworksRead(month) {
    const kept = networkMonths.get(month);
    if (!kept) return true;
    if (kept.edition !== NETWORKS_EDITION && !kept.failure) return true;
    if (isFinalAnswer(kept, month)) return false;
    return now() - kept.readAt >= NETWORKS_MS;
  }

  /** @param {string} month @param {boolean} [verify] */
  async function readNetworkMonth(month, verify = false) {
    const key = nameNetworkMonthKey(month);
    if (!networkMonths.has(month)) networkMonths.set(month, await storage.get(key));
    const kept = networkMonths.get(month);
    // A reminder needs current listings, but a finalized month cannot change.
    if (!isDueForNetworksRead(month) && (!verify || isFinalAnswer(kept, month))) return kept.data;
    try {
      const data = await fetchEspn(WNBASnapshot.NETWORKS_REQUEST(month));
      WNBASnapshot.validateFeedResponse("networks", data);
      networkMonths.set(month, {
        edition: NETWORKS_EDITION,
        readAt: now(),
        answeredAt: now(),
        data: trimNetworkAnswer(data),
        failure: null,
      });
    } catch (error) {
      const answeredAt = kept?.answeredAt ?? null;
      const data = kept?.data ?? null;
      networkMonths.set(month, {
        edition: kept?.edition,
        readAt: now(),
        answeredAt,
        data,
        failure: describeError(error),
      });
    }
    const updated = networkMonths.get(month);
    await storage
      .put(key, updated)
      .catch((error) => console.error(`Keeping network listings failed: ${describeError(error)}`));
    return updated.data;
  }

  // Each month with a playoff game or a team's nearest game, and yesterday's and today's, since a
  // late game is still being played after midnight Eastern, and the schedule may not have answered.
  function listNetworkMonths(schedule, season) {
    const starts = WNBASnapshot.listScheduledStarts(schedule, season).map(Date.parse);
    const times = [now() - DAY_MS, now(), ...starts].filter(Number.isFinite);
    return [...new Set(times.map(formatEspnMonth))].sort();
  }

  async function readNetworks(schedule, season, verify, failures) {
    const months = listNetworkMonths(schedule, season);
    const answers = await Promise.all(months.map((month) => readNetworkMonth(month, verify)));
    const reasons = months.map((month) => networkMonths.get(month)?.failure).filter(Boolean);
    if (reasons.length) failures.networks = [...new Set(reasons)].join("; ");
    return answers.filter(Boolean);
  }

  async function fetchResponses(season, verify = false) {
    await slowFeeds.forgetFeed("players", nameAveragesRequest(season));
    const status = createFeedReadStatus();
    const { failures, noteFailure: noteReason, noteNextRead: onNextRead } = status;
    /** @param {keyof typeof FEED_DATA} name */
    const noteFailure = (name) => (/** @type {unknown} */ error) => {
      noteReason(name)(describeError(error));
      return null;
    };
    const scoreboard = await fetchFeed(
      "scoreboard",
      WNBASnapshot.REQUESTS.scoreboard,
      season,
    ).catch(noteFailure("scoreboard"));
    await slowFeeds.noteFinalCount(scoreboard ? countFinals(scoreboard) : null);
    const hasGamesLeftLive = (schedule) =>
      WNBASnapshot.listGamesLeftLive(schedule, scoreboard, season).size > 0;
    const [scheduleAnswer, bracket, standings] = await Promise.all([
      readSlowFeed("schedule", WNBASnapshot.REQUESTS.schedule, season, {
        isBehind: hasGamesLeftLive,
        readAgain: verify,
        onFailure: noteReason("schedule"),
        onNextRead,
      }).catch(noteFailure("schedule")),
      // A kept bracket can only hold a reminder back: a series' wins only grow, and the games
      // played count them too.
      readSlowFeed("bracket", WNBASnapshot.REQUESTS.bracket(season), season, {
        readAgain: verify,
        onFailure: noteReason("bracket"),
        onNextRead,
      }).catch(noteFailure("bracket")),
      readSlowFeed("standings", WNBASnapshot.REQUESTS.standings(season), season, {
        onFailure: noteReason("standings"),
        onNextRead,
      }).catch(noteFailure("standings")),
    ]);
    /** @param {any} schedule */
    const throwIfNoneAnswered = (schedule) => {
      if (!scoreboard && !schedule && !bracket)
        throw new Error(
          `None of the WNBA's feeds answered with data: ${describeFailures(failures)}`,
        );
    };
    // With every feed down, ESPN has no league games to stand in for, so it isn't read.
    throwIfNoneAnswered(scheduleAnswer);
    // A reminder goes out only on a current read of today's games. Each game a reminder can be due
    // for is played on the league's today, so a kept schedule stands in once the scoreboard lists
    // them all, or, while the scoreboard doesn't answer, once ESPN agrees with it on them all.
    /** @param {import("./backup-probe.js").Backup | null} [backup] */
    const isScheduleConfirmed = (backup = null) =>
      !verify ||
      !failures.schedule ||
      (scoreboard
        ? WNBASnapshot.isTodayOnScoreboard(scheduleAnswer, scoreboard, season, now())
        : WNBASnapshot.isTodayOnBackup(scheduleAnswer, backup, season, now()));
    const needsBackup = !scoreboard || (isScheduleConfirmed() && hasGamesLeftLive(scheduleAnswer));
    const { backup, failure, nextReadAt: probeAt } = await readBackup(needsBackup);
    onNextRead(probeAt);
    if (failure) failures.backup = failure;
    const schedule = isScheduleConfirmed(backup) ? scheduleAnswer : null;
    throwIfNoneAnswered(schedule);
    // The networks are read only for a confirmed schedule, which may wait on ESPN's answer.
    const networks = await readNetworks(schedule, season, verify, failures);
    return {
      responses: { scoreboard, schedule, bracket, standings, backup, networks },
      ...status.readStatus(),
    };
  }

  /**
   * @param {number} season
   * @param {number} requestedAt
   * @param {boolean} [verify]
   */
  async function fetchSnapshot(season, requestedAt, verify = false) {
    const { responses, failures, nextReadAt } = await fetchResponses(season, verify);
    const snapshot = WNBASnapshot.buildSnapshot(responses, { season, now: requestedAt });
    const coverageGap = describeCoverageGap(responses, snapshot);
    const ended = await addGameEnds(snapshot);
    const espnAnswers = [...(responses.networks ?? []), ...(responses.backup?.answers ?? [])];
    return {
      ...ended,
      identityRecords: readIdentityGames(espnAnswers, findTeamCodeByEspnId),
      espnMatches: listEspnMatches(ended, espnAnswers),
      nextReadAt,
      failures: coverageGap ? { ...failures, backup: coverageGap } : failures,
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
