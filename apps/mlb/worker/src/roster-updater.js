import { isSameJson } from "#shared/compare.js";
import { namePlayerIndexKey } from "#shared/page-search.js";
import { addDays, readEasternDay } from "#shared/days.js";
import { listClubs, readClubId, readMlbTeamId } from "../../page/js/snapshot.js";
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
import { splitIntoBatches } from "./pitchers.js";
import {
  describeRoster,
  indexSeasonStats,
  isOnRoster,
  listRosterRequest,
  listSeasonStatsRequest,
  nameRosterKey,
} from "./rosters.js";
import { createPerStoreJob, createSavedDocs } from "../../../../shared/worker/background-job.js";
import { createFeedKeeper, isPlayerReadDue } from "../../../../shared/worker/feed-keeper.js";
import { describeError } from "../../../../shared/worker/responses.js";

// Keeps each club's roster and each player on it for the current season, and the list of every
// player on one that search finds, so a club's Roster section, a player's sheet, and search read
// only the store. A club's roster changes only with a
// transaction, which MLB lists for the whole league in one request, so each run reads that list
// once it's old, and reads again only the rosters of the clubs with a transaction it hasn't seen, a
// few clubs a run, and every club's once a day in case one was missed. Every player's numbers, in
// the regular season and the postseason, and the hitters MLB ranks, are read as a game ends, MLB's
// list of every player, with his facts, once a day, and ESPN's injury report, which says why each
// player on the injured list is there, for the whole league once an hour. Each player's last games
// are read, a
// batch at a time, as his games add up, and once more as they settle, and his totals wait for them.
// Each roster and player is saved again only when it changed.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const RUN_DELAY_MS = 5 * MINUTE_MS;
const CLUBS_PER_RUN = 6;
// Every rostered player's first read spreads over a few runs, while a night's games need few.
const GAME_LOG_BATCHES_PER_RUN = 4;
const ROSTER_MAX_AGE_MS = 24 * HOUR_MS;
const LEAGUE_NAME = "MLB";

const FEEDS = {
  rosterStats: { maxAgeMs: 6 * HOUR_MS, changesWithGames: true },
  transactions: { maxAgeMs: 30 * MINUTE_MS, changesWithGames: false },
  people: { maxAgeMs: 24 * HOUR_MS, changesWithGames: false },
  injuries: { maxAgeMs: HOUR_MS, changesWithGames: false },
};

/** @typedef {import("../../../../shared/worker/season-store.js").JobContext} JobContext */
/** @typedef {import("../../../../shared/worker/feed-keeper.js").PlayerRead} PlayerRead */
/**
 * Every player's numbers this season, by id, and his facts, the hitters MLB ranks, and why each
 * player ESPN's injury report names is out, by nameInjuredKey. A table that hasn't answered is
 * empty.
 * @typedef {import("./players.js").PlayerNumbers & { people: Map<number, any>, qualified: any, outPlayers: Map<string, import("./injuries.js").OutReason> }} SeasonNumbers
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

/** @param {number} season */
export const nameGameLogReadsKey = (season) => `game-log-reads:${season}:v${LAST_GAMES_VERSION}`;

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

/**
 * Logs a read that failed, and answers null in its place.
 * @param {string} what
 */
const logFailure = (what) => (/** @type {unknown} */ error) => {
  console.error(`Reading ${what} failed: ${describeError(error)}`);
  return null;
};

/** One store's update, with what it keeps between runs while it stays in memory. */
function createStoreUpdate() {
  /** @type {ReturnType<typeof createFeedKeeper> | null} */
  let keeper = null;
  const { readDoc, saveDoc } = createSavedDocs();

  /**
   * @param {JobContext} context
   * @param {string} path
   */
  const fetchJson = (context, path) => fetchMlbJson(context.fetchImpl, path, null);

  /**
   * @param {string} name which feed's limits apply
   * @param {string} key what the answer is kept under
   * @param {() => Promise<any>} load
   */
  const readFeed = (name, key, load) =>
    /** @type {ReturnType<typeof createFeedKeeper>} */ (keeper).readFeed(name, key, load);

  /**
   * @param {JobContext} context
   * @param {string} path
   */
  const readStats = (context, path) =>
    readFeed("rosterStats", path, () => fetchJson(context, path));

  /**
   * Every player's numbers and facts, and why those on the injured list are there, or null when
   * MLB hasn't answered the regular season's. The postseason's, the ranked hitters', the facts, and
   * the injury report stand empty while they don't answer.
   * @param {JobContext} context
   * @param {number} season
   * @returns {Promise<SeasonNumbers | null>}
   */
  async function readSeasonNumbers(context, season) {
    const [hitting, pitching, postseasonHitting, postseasonPitching, qualified, people, injured] =
      await Promise.allSettled([
        readStats(context, listSeasonStatsRequest(season, "hitting")),
        readStats(context, listSeasonStatsRequest(season, "pitching")),
        readStats(context, listSeasonStatsRequest(season, "hitting", { gameType: "P" })),
        readStats(context, listSeasonStatsRequest(season, "pitching", { gameType: "P" })),
        readStats(context, listSeasonStatsRequest(season, "hitting", { pool: "qualified" })),
        readFeed("people", String(season), () => fetchJson(context, listPeopleRequest(season))),
        readFeed("injuries", "league", async () =>
          listInjuredPlayers(await fetchInjuries(context.fetchImpl)),
        ),
      ]);
    if (hitting.status === "rejected" || pitching.status === "rejected") {
      logFailure("every player's numbers")(
        hitting.status === "rejected" ? hitting.reason : /** @type {any} */ (pitching).reason,
      );
      return null;
    }
    /** @param {PromiseSettledResult<any>} result */
    const readAnswer = (result) => (result.status === "fulfilled" ? result.value : null);
    return {
      hitting: indexSeasonStats(hitting.value),
      pitching: indexSeasonStats(pitching.value),
      postseasonHitting: indexSeasonStats(readAnswer(postseasonHitting)),
      postseasonPitching: indexSeasonStats(readAnswer(postseasonPitching)),
      qualified: readAnswer(qualified),
      people: indexPeople(readAnswer(people)),
      outPlayers: indexInjuredPlayers(readAnswer(injured) ?? []),
    };
  }

  /**
   * @param {JobContext} context
   * @param {number} season
   */
  async function readTransactions(context, season) {
    const today = readEasternDay(context.now()).date;
    const answer = await readFeed("transactions", String(season), () =>
      fetchJson(context, listTransactionsRequest(today)),
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
   * @param {JobContext} context
   * @param {number} season
   * @param {RosterReads} reads
   * @returns {Promise<RosterReads>}
   */
  async function readDueRosters(context, season, reads) {
    const due = listDueClubs(reads, context.now());
    const results = await Promise.allSettled(
      due.map((club) =>
        fetchJson(context, listRosterRequest(/** @type {number} */ (readMlbTeamId(club)), season)),
      ),
    );
    const readAt = { ...reads.readAt };
    let changed = reads.changed;
    for (const [index, result] of results.entries()) {
      const club = due[index];
      if (result.status === "rejected") {
        console.error(`Reading ${club}'s roster failed: ${describeError(result.reason)}`);
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
   * @param {JobContext} context
   * @param {number} season
   * @param {string} club
   * @param {any} roster MLB's answer for the club's roster
   * @param {SeasonNumbers} numbers
   * @param {Map<string, any>} lastGames each player's, by the key it's kept under
   */
  async function savePlayers(context, season, club, roster, numbers, lastGames) {
    for (const entry of (roster?.roster ?? []).filter(isOnRoster)) {
      const id = entry.person.id;
      const person = numbers.people.get(id) ?? null;
      await saveDoc(
        context.docs,
        namePlayerKey(season, id),
        describePlayer({
          ...numbers,
          entry,
          club,
          season,
          person,
          lastGames: lastGames.get(`${nameLastGamesPrefix(season)}${id}`) ?? null,
          out: numbers.outPlayers.get(nameInjuredKey(club, entry.person.fullName ?? "")) ?? null,
        }),
      );
    }
  }

  /**
   * The players on every roster read so far, by id, from each club's kept answer.
   * @param {JobContext} context
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
   * @param {JobContext} context
   * @param {number} season
   * @param {SeasonNumbers} numbers
   * @returns {Promise<Record<string, PlayerRead>>}
   */
  async function readDueGameLogs(context, season, numbers) {
    /** @type {Record<string, PlayerRead>} */
    const reads = (await context.storage.get(nameGameLogReadsKey(season))) ?? {};
    const now = context.now();
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
        console.error(`Reading players' last games failed: ${describeError(result.reason)}`);
        for (const id of batches[index]) if (reads[id]) reads[id] = { ...reads[id], failedAt: now };
        continue;
      }
      const people = new Map(
        (result.value?.people ?? []).map((/** @type {any} */ person) => [person.id, person]),
      );
      for (const id of batches[index]) {
        const person = people.get(id);
        const lastGames = person ? describeLastGames(person) : { hitting: [], pitching: [] };
        await context.storage.put(`${nameLastGamesPrefix(season)}${id}`, lastGames);
        const games = countGames(numbers, id);
        reads[id] = { games, at: now, isSettled: reads[id]?.games === games };
      }
    }
    await context.storage.put(nameGameLogReadsKey(season), reads);
    return reads;
  }

  /**
   * Every player's numbers, but with the totals of each whose last games are behind them as his
   * doc keeps them, so his Roster row and his sheet hold them together.
   * @param {JobContext} context
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
   * @param {JobContext} context
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
      await saveDoc(
        context.docs,
        nameRosterKey(club),
        describeRoster({ club, season, roster, hitting, pitching }),
      );
      await savePlayers(context, season, club, roster, numbers, lastGames);
      rosters.push({ club, roster });
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
   * @param {JobContext} context
   * @param {number} season
   */
  async function updateRosters(context, season) {
    const stored = await context.storage.get(nameReadsKey(season));
    /** @type {RosterReads} */
    let reads = stored ?? { readAt: {}, changed: [], seen: null };
    const transactions = await readTransactions(context, season).catch(logFailure("transactions"));
    if (transactions) reads = noteTransactions(reads, transactions);
    reads = await readDueRosters(context, season, reads);
    if (!isSameJson(stored, reads)) await context.storage.put(nameReadsKey(season), reads);
    const numbers = await readSeasonNumbers(context, season);
    if (!numbers) return;
    const gameLogReads = await readDueGameLogs(context, season, numbers);
    await saveRosters(context, season, await holdTotals(context, season, numbers, gameLogReads));
  }

  /** @param {JobContext} context */
  async function updateStore(context) {
    keeper ??= createFeedKeeper({
      feeds: FEEDS,
      leagueName: LEAGUE_NAME,
      now: context.now,
      storage: context.storage,
    });
    const season = (await context.docs.read("live/current"))?.season;
    if (!Number.isInteger(season)) return;
    await keeper.noteFinalCount(countSlateFinals(await context.docs.read(`seasons/${season}`)));
    await updateRosters(context, season).catch(logFailure(`${season}'s rosters`));
  }

  return updateStore;
}

export const createRosterJob = () => createPerStoreJob(RUN_DELAY_MS, createStoreUpdate);
