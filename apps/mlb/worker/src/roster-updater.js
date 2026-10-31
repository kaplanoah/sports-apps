import { isSameJson } from "#shared/compare.js";
import { namePlayerIndexKey } from "#shared/page-search.js";
import { addDays, readEasternDay } from "#shared/days.js";
import { listClubs, readClubId, readMlbTeamId } from "./adapters/mlb.js";
import {
  fetchInjuries,
  indexInjuredPlayers,
  listInjuredPlayers,
  nameInjuredKey,
} from "./injuries.js";
import { fetchMlbJson } from "./mlb.js";
import { indexRosters } from "./player-index.js";
import { countSlateFinals } from "./pitcher-updater.js";
import {
  describeHitters,
  describeLastGames,
  describePlayer,
  indexPeople,
  listGameLogRequest,
  listPeopleRequest,
  nameHittersKey,
  namePlayerKey,
} from "./players.js";
import { readPeopleBatch, splitIntoBatches } from "./adapters/pitchers.js";
import {
  describeRoster,
  indexSeasonStats,
  isOnRoster,
  listRosterRequest,
  listSeasonStatsRequest,
  nameRosterKey,
  trimHitting,
  trimPitching,
} from "./rosters.js";
import {
  createPerStoreJob,
  createSavedDocs,
  createVersionForgetter,
  nameVersionedKey,
} from "../../../../shared/worker/background-job.js";
import { createFeedKeeper, isPlayerReadDue } from "../../../../shared/worker/feed-keeper.js";
import {
  catchFailure,
  noteFailure,
  readJobFeed,
  runWithStatus,
} from "../../../../shared/worker/job-status.js";

// Keeps each club's roster and each player on it for the current season, and the list of every
// player on one that search finds, so a club's Roster section, a player's sheet, and search read
// only the store. A club's roster changes only with a transaction, which MLB lists for the whole
// league in one request, so each run reads that list once it's old, and reads again only the
// rosters of the clubs with a transaction it hasn't seen, a few clubs a run, and every club's once
// a day in case one was missed. Every player's numbers, in the regular season and the postseason,
// and the hitters MLB ranks, are read as a game ends, MLB's list of every player, with his facts,
// once a day, and ESPN's injury report, which says why each player on the injured list is there,
// for the whole league once an hour. Each player's last games are read, a batch at a time, as his
// games add up, and once more as they settle, and his totals wait for them. Each roster and player
// is saved again only when it changed, and each run saves how it went in `rosters/status`.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const RUN_DELAY_MS = 5 * MINUTE_MS;
const CLUBS_PER_RUN = 6;
// Every rostered player's first read spreads over a few runs, while a night's games need few.
const GAME_LOG_BATCHES_PER_RUN = 4;
const ROSTER_MAX_AGE_MS = 24 * HOUR_MS;
const STATUS_KEY = "rosters/status";

const FEEDS = {
  rosterStats: { maxAgeMs: 6 * HOUR_MS, changesWithGames: true },
  transactions: { maxAgeMs: 30 * MINUTE_MS, changesWithGames: false },
  people: { maxAgeMs: 24 * HOUR_MS, changesWithGames: false },
  injuries: { maxAgeMs: HOUR_MS, changesWithGames: false },
};

/** @typedef {import("../../../../shared/worker/season-store.js").JobContext} JobContext */
/** @typedef {import("../../../../shared/worker/job-status.js").RunContext} RunContext */
/** @typedef {import("../../../../shared/worker/feed-keeper.js").PlayerRead} PlayerRead */
/**
 * Every player's numbers this season, by id, and his facts, the hitters MLB ranks, and why each
 * player ESPN's injury report names is out, by nameInjuredKey. A table that hasn't answered is
 * empty.
 * @typedef {import("./players.js").PlayerNumbers & { people: Map<number, any>, qualified: any, outPlayers: Map<string, import("./injuries.js").OutReason>, failed?: Set<string> }} SeasonNumbers
 */
/**
 * When each club's roster was read, which clubs have a transaction since, and the transactions
 * seen so far, none before the list is first read.
 * @typedef {{ readAt: Record<string, number>, changed: string[], seen: number[] | null }} RosterReads
 */

/** @param {number} season */
const nameReadsKey = (season) => `roster-reads:${season}`;

// Raised whenever a player's last games keep more of MLB's game log, so each player's is read again.
const LAST_GAMES_VERSION = 2;

/**
 * @param {number} season
 * @param {number} [version] the last games' version
 */
export const nameGameLogReadsKey = (season, version = LAST_GAMES_VERSION) =>
  nameVersionedKey(`game-log-reads:${season}`, version);

/** @param {number} season */
const nameLastGamesPrefix = (season) => `last-games:${season}:`;

const TOTALS = /** @type {const} */ ([
  "hitting",
  "pitching",
  "postseasonHitting",
  "postseasonPitching",
]);

/**
 * A player's games in every table, regular season and postseason, which grows as he plays.
 * @param {import("./players.js").PlayerNumbers} numbers
 * @param {number} id
 */
const countGames = (numbers, id) =>
  TOTALS.map((table) => numbers[table].get(id)?.gamesPlayed ?? 0).reduce(
    (total, games) => total + games,
    0,
  );

// A player's totals and his last games tell one story, so totals that count a game his log hasn't
// been read with yet wait for a later run to read it, unless MLB didn't answer the last read of it,
// when they show rather than wait on MLB.
/**
 * @param {PlayerRead} read his log's last read
 * @param {number} games the games his totals count now
 */
const isLogBehind = (read, games) => games > read.games && read.failedAt === undefined;

/**
 * Puts a player's totals in a table as his doc keeps them, or takes him out where it keeps none.
 * @param {Map<number, any>} table
 * @param {number} id
 * @param {any} kept
 */
const putTotals = (table, id, kept) => (kept ? table.set(id, kept) : table.delete(id));

/**
 * @param {number} season
 * @param {string} club
 */
const nameAnswerKey = (season, club) => `roster-answer:${season}:${club}`;

/**
 * Every transaction across MLB and the minors, from yesterday through today.
 * @param {string} today
 */
export const listTransactionsRequest = (today) =>
  `/api/v1/transactions?sportId=1&startDate=${addDays(today, -1)}&endDate=${today}` +
  "&fields=transactions,id,fromTeam,toTeam";

/**
 * The page's clubs on either side of a transaction.
 * @param {any} transaction
 */
const listTransactionClubs = (transaction) =>
  [transaction.fromTeam?.id, transaction.toTeam?.id].map(readClubId).filter(Boolean);

/**
 * The clubs whose roster a transaction not seen before may have changed.
 * @param {any[]} transactions
 * @param {Set<number>} seen
 */
const listChangedClubs = (transactions, seen) =>
  transactions.filter((transaction) => !seen.has(transaction.id)).flatMap(listTransactionClubs);

/**
 * The clubs whose roster to read this run: those never read first, then those with a transaction
 * since, then those read longest ago once a day has passed.
 * @param {RosterReads} reads
 * @param {number} now
 */
function listDueClubs(reads, now) {
  const clubs = listClubs();
  const unread = clubs.filter((club) => reads.readAt[club] === undefined);
  const changed = clubs.filter((club) => reads.changed.includes(club) && !unread.includes(club));
  const old = clubs
    .filter((club) => now - (reads.readAt[club] ?? now) >= ROSTER_MAX_AGE_MS)
    .sort((first, second) => reads.readAt[first] - reads.readAt[second]);
  return [...new Set([...unread, ...changed, ...old])].slice(0, CLUBS_PER_RUN);
}

/** One store's update, with what it keeps between runs while it stays in memory. */
function createStoreUpdate() {
  /** @type {ReturnType<typeof createFeedKeeper> | null} */
  let keeper = null;
  const { readDoc, saveDoc } = createSavedDocs();
  const forgetEarlierVersions = createVersionForgetter();

  /**
   * @param {RunContext} context
   * @param {string} path
   */
  const fetchJson = (context, path) => fetchMlbJson(context.fetchImpl, path, null);

  /**
   * @param {RunContext} context
   * @param {string} name which feed's limits apply
   * @param {string} key what the answer is kept under
   * @param {string} label
   * @param {() => Promise<any>} load
   * @param {(answer: any) => unknown} [validate]
   */
  const readFeed = (context, name, key, label, load, validate) =>
    readJobFeed(context, /** @type {ReturnType<typeof createFeedKeeper>} */ (keeper), {
      name,
      key,
      label,
      load,
      validate,
    });

  /**
   * @param {RunContext} context
   * @param {string} path
   * @param {string} group
   * @param {string} label
   * @param {boolean} [qualified]
   */
  const readStats = (context, path, group, label, qualified = false) =>
    readFeed(
      context,
      "rosterStats",
      path,
      label,
      () => fetchJson(context, path),
      (answer) => {
        indexSeasonStats(answer, group === "hitting" ? trimHitting : trimPitching);
        if (qualified) describeHitters(answer);
      },
    );

  /**
   * Every player's numbers and facts, and why those on the injured list are there, or null when
   * MLB hasn't answered the regular season's. The postseason's, the ranked hitters', the facts, and
   * the injury report stand empty while they don't answer.
   * @param {RunContext} context
   * @param {number} season
   * @returns {Promise<SeasonNumbers | null>}
   */
  async function readSeasonNumbers(context, season) {
    const [hitting, pitching, postseasonHitting, postseasonPitching, qualified, people, injured] =
      await Promise.allSettled([
        readStats(
          context,
          listSeasonStatsRequest(season, "hitting"),
          "hitting",
          `${season}'s regular-season hitting`,
        ),
        readStats(
          context,
          listSeasonStatsRequest(season, "pitching"),
          "pitching",
          `${season}'s regular-season pitching`,
        ),
        readStats(
          context,
          listSeasonStatsRequest(season, "hitting", { gameType: "P" }),
          "hitting",
          `${season}'s postseason hitting`,
        ),
        readStats(
          context,
          listSeasonStatsRequest(season, "pitching", { gameType: "P" }),
          "pitching",
          `${season}'s postseason pitching`,
        ),
        readStats(
          context,
          listSeasonStatsRequest(season, "hitting", { pool: "qualified" }),
          "hitting",
          `${season}'s qualified hitters`,
          true,
        ),
        readFeed(
          context,
          "people",
          String(season),
          `${season}'s player facts`,
          () => fetchJson(context, listPeopleRequest(season)),
          indexPeople,
        ),
        readFeed(context, "injuries", "league", `${season}'s injuries`, async () =>
          listInjuredPlayers(await fetchInjuries(context.fetchImpl)),
        ),
      ]);
    if (hitting.status === "rejected" || pitching.status === "rejected") return null;
    /** @param {PromiseSettledResult<any>} result */
    const readAnswer = (result) => (result.status === "fulfilled" ? result.value : null);
    return {
      hitting: indexSeasonStats(hitting.value, trimHitting),
      pitching: indexSeasonStats(pitching.value, trimPitching),
      postseasonHitting: indexSeasonStats(readAnswer(postseasonHitting), trimHitting),
      postseasonPitching: indexSeasonStats(readAnswer(postseasonPitching), trimPitching),
      qualified: readAnswer(qualified),
      people: indexPeople(readAnswer(people)),
      outPlayers: indexInjuredPlayers(readAnswer(injured) ?? []),
      failed: new Set([
        ...(people.status === "rejected" ? ["people"] : []),
        ...(postseasonHitting.status === "rejected" ? ["postseasonHitting"] : []),
        ...(postseasonPitching.status === "rejected" ? ["postseasonPitching"] : []),
      ]),
    };
  }

  /**
   * @param {RunContext} context
   * @param {number} season
   */
  async function readTransactions(context, season) {
    const today = readEasternDay(context.now()).date;
    const answer = await readFeed(
      context,
      "transactions",
      String(season),
      `${season}'s transactions`,
      () => fetchJson(context, listTransactionsRequest(today)),
    );
    return answer?.transactions ?? [];
  }

  /**
   * Notes the transactions not seen before, and the clubs they may have changed.
   * @param {RosterReads} reads
   * @param {any[]} transactions
   * @returns {RosterReads}
   */
  function noteTransactions(reads, transactions) {
    const changed = reads.seen ? listChangedClubs(transactions, new Set(reads.seen)) : [];
    return {
      ...reads,
      changed: [...new Set([...reads.changed, ...changed])],
      seen: transactions.map((transaction) => transaction.id),
    };
  }

  /**
   * Reads the due clubs' rosters, keeping each answer, and notes when each was read. A roster MLB
   * doesn't answer is read on a later run.
   * @param {RunContext} context
   * @param {number} season
   * @param {RosterReads} reads
   * @returns {Promise<RosterReads>}
   */
  async function readDueRosters(context, season, reads) {
    const due = listDueClubs(reads, context.now());
    const results = await Promise.allSettled(
      due.map((club) =>
        fetchJson(
          context,
          listRosterRequest(/** @type {number} */ (readMlbTeamId(club)), season),
        ).then((answer) => {
          describeRoster({ club, season, roster: answer, hitting: new Map(), pitching: new Map() });
          return answer;
        }),
      ),
    );
    const readAt = { ...reads.readAt };
    let changed = reads.changed;
    for (const [index, result] of results.entries()) {
      const club = due[index];
      if (result.status === "rejected") {
        noteFailure(context.failures, `Reading ${club}'s roster`, result.reason);
        continue;
      }
      await context.storage.put(nameAnswerKey(season, club), result.value);
      readAt[club] = context.now();
      changed = changed.filter((each) => each !== club);
    }
    return { ...reads, readAt, changed };
  }

  /**
   * Saves each player on a club's roster, as his numbers are now.
   * @param {RunContext} context
   * @param {number} season
   * @param {string} club
   * @param {any} roster MLB's answer for the club's roster
   * @param {SeasonNumbers} numbers
   * @param {Map<string, any>} lastGames each player's, by the key it's kept under
   */
  async function savePlayers(context, season, club, roster, numbers, lastGames) {
    for (const entry of roster.roster.filter(isOnRoster)) {
      const id = entry.person.id;
      const person = numbers.people.get(id) ?? null;
      try {
        const kept = await readDoc(context.docs, namePlayerKey(season, id));
        const player = describePlayer({
          ...numbers,
          entry,
          club,
          season,
          person,
          kept,
          lastGames: lastGames.get(`${nameLastGamesPrefix(season)}${id}`) ?? null,
          out: numbers.outPlayers.get(nameInjuredKey(club, entry.person.fullName ?? "")) ?? null,
        });
        await saveDoc(context.docs, namePlayerKey(season, id), player);
      } catch (error) {
        noteFailure(context.failures, "Keeping a player", error);
      }
    }
  }

  /**
   * The players on every roster read so far, by id, from each club's kept answer.
   * @param {RunContext} context
   * @param {number} season
   */
  async function listRosteredIds(context, season) {
    const ids = [];
    for (const club of listClubs()) {
      const roster = await context.storage.get(nameAnswerKey(season, club));
      for (const entry of (roster?.roster ?? []).filter(isOnRoster)) ids.push(entry.person.id);
    }
    return ids;
  }

  /**
   * Reads the last games of the rostered players who have played since they were last read, a
   * few batches a run, and keeps each one's, and answers when each player's was last read. A batch
   * MLB doesn't answer is read on a later run.
   * @param {RunContext} context
   * @param {number} season
   * @param {SeasonNumbers} numbers
   * @returns {Promise<Record<string, PlayerRead>>}
   */
  async function readDueGameLogs(context, season, numbers) {
    /** @type {Record<string, PlayerRead>} */
    const reads = (await context.storage.get(nameGameLogReadsKey(season))) ?? {};
    const now = context.now();
    const label = `Reading ${season}'s player game logs`;
    const due = (await listRosteredIds(context, season)).filter((id) =>
      isPlayerReadDue(reads[id], countGames(numbers, id), now),
    );
    const batches = splitIntoBatches(due).slice(0, GAME_LOG_BATCHES_PER_RUN);
    if (!batches.length) return reads;
    const today = readEasternDay(now).date;
    const results = await Promise.allSettled(
      batches.map((batch) => fetchJson(context, listGameLogRequest(season, batch, today))),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        noteFailure(context.failures, label, result.reason);
        for (const id of batches[index]) if (reads[id]) reads[id] = { ...reads[id], failedAt: now };
        continue;
      }
      let batch;
      try {
        batch = readPeopleBatch(result.value, batches[index], (error) =>
          noteFailure(context.failures, label, error),
        );
      } catch (error) {
        noteFailure(context.failures, label, error);
        for (const id of batches[index]) if (reads[id]) reads[id] = { ...reads[id], failedAt: now };
        continue;
      }
      for (const id of batches[index]) {
        const person = batch.people.get(id);
        if (batch.failed.has(id)) {
          if (reads[id]) reads[id] = { ...reads[id], failedAt: now };
          continue;
        }
        try {
          const lastGames = person ? describeLastGames(person) : { hitting: [], pitching: [] };
          await context.storage.put(`${nameLastGamesPrefix(season)}${id}`, lastGames);
          const games = countGames(numbers, id);
          reads[id] = { games, at: now, isSettled: reads[id]?.games === games };
        } catch (error) {
          noteFailure(context.failures, label, error);
          if (reads[id]) reads[id] = { ...reads[id], failedAt: now };
        }
      }
    }
    await context.storage.put(nameGameLogReadsKey(season), reads);
    await forgetEarlierVersions(
      context.storage,
      (version) => nameGameLogReadsKey(season, version),
      LAST_GAMES_VERSION,
    );
    return reads;
  }

  /**
   * Every player's numbers, but with the totals of each whose last games are behind them as his
   * doc keeps them, so his Roster row and his sheet hold them together.
   * @param {RunContext} context
   * @param {number} season
   * @param {SeasonNumbers} numbers
   * @param {Record<string, PlayerRead>} gameLogReads
   * @returns {Promise<SeasonNumbers>}
   */
  async function holdTotals(context, season, numbers, gameLogReads) {
    const heldIds = Object.entries(gameLogReads)
      .map(([id, read]) => /** @type {const} */ ([Number(id), read]))
      .filter(([id, read]) => isLogBehind(read, countGames(numbers, id)))
      .map(([id]) => id);
    if (!heldIds.length) return numbers;
    const held = {
      ...numbers,
      hitting: new Map(numbers.hitting),
      pitching: new Map(numbers.pitching),
      postseasonHitting: new Map(numbers.postseasonHitting),
      postseasonPitching: new Map(numbers.postseasonPitching),
    };
    for (const id of heldIds) {
      const kept = await readDoc(context.docs, namePlayerKey(season, id));
      if (kept) for (const table of TOTALS) putTotals(held[table], id, kept[table]);
    }
    return held;
  }

  /**
   * Saves each club's roster that has been read, and each player on it, with every player's
   * numbers as they are now, the hitters MLB ranks, and, once every club's roster has been read,
   * the season's list of players.
   * @param {RunContext} context
   * @param {number} season
   * @param {SeasonNumbers} numbers
   */
  async function saveRosters(context, season, numbers) {
    const { hitting, pitching } = numbers;
    const lastGames = await context.storage.list(nameLastGamesPrefix(season));
    const rosters = [];
    for (const club of listClubs()) {
      const roster = await context.storage.get(nameAnswerKey(season, club));
      if (!roster) continue;
      try {
        const record = describeRoster({ club, season, roster, hitting, pitching });
        await saveDoc(context.docs, nameRosterKey(club), record);
        await savePlayers(context, season, club, roster, numbers, lastGames);
        rosters.push({ club, roster });
      } catch (error) {
        noteFailure(context.failures, `Keeping ${club}'s ${season} roster`, error);
      }
    }
    if (numbers.qualified)
      await saveDoc(context.docs, nameHittersKey(season), describeHitters(numbers.qualified));
    if (rosters.length === listClubs().length)
      await saveDoc(
        context.docs,
        namePlayerIndexKey(season),
        indexRosters(season, rosters, numbers.people),
      );
  }

  /**
   * @param {RunContext} context
   * @param {number} season
   */
  async function updateRosters(context, season) {
    const stored = await context.storage.get(nameReadsKey(season));
    /** @type {RosterReads} */
    let reads = stored ?? { readAt: {}, changed: [], seen: null };
    const transactions = await readTransactions(context, season).catch(() => null);
    if (transactions) reads = noteTransactions(reads, transactions);
    reads = await readDueRosters(context, season, reads);
    if (!isSameJson(stored, reads)) await context.storage.put(nameReadsKey(season), reads);
    const numbers = await readSeasonNumbers(context, season);
    if (!numbers) return;
    const gameLogReads = await readDueGameLogs(context, season, numbers);
    await saveRosters(context, season, await holdTotals(context, season, numbers, gameLogReads));
  }

  /** @param {RunContext} context */
  async function keepRosters(context) {
    keeper ??= createFeedKeeper({
      feeds: FEEDS,
      now: context.now,
      storage: context.storage,
    });
    const season = (await context.docs.read("live/current"))?.season;
    if (!Number.isInteger(season)) return;
    await keeper.noteFinalCount(countSlateFinals(await context.docs.read(`seasons/${season}`)));
    await catchFailure(context.failures, `Keeping ${season}'s rosters`, () =>
      updateRosters(context, season),
    );
  }

  /** @param {JobContext} context */
  return (context) => runWithStatus(context, { statusKey: STATUS_KEY, updateStore: keepRosters });
}

export const createRosterJob = () => createPerStoreJob(RUN_DELAY_MS, createStoreUpdate);
