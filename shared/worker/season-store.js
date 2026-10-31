import { nameStoredFeedKey } from "./feed-keeper.js";
import { createIdentityDocuments } from "./identity-documents.js";
import {
  createRequestBudget,
  RequestBudgetExhausted,
  ALARM_REQUEST_ALLOWANCE,
  HISTORY_REQUESTS_PER_RUN,
} from "./request-budget.js";
import { listFailureReasons, noteFeedFailures } from "./feed-failures.js";
import { createGameReminders } from "./game-reminders.js";
import { isSameJson } from "../page/compare.js";
import { isStoreDocumentPath, isStoreName } from "../page/store-path.js";
import { createPushService } from "./push.js";
import { describeError, respondError, respondJson, respondMethodNotAllowed } from "./responses.js";

// An app's saved data, kept in one Durable Object so every device reads the latest write.
// Documents come back with sorted keys, and a missing one reads as null. The page can read any
// document but writes none, since what a viewer chooses stays on their own device.
//
// An alarm keeps the current season up to date from the league while no page is open, and tells
// subscribed devices about new updates. It also wakes for reminder verification, delivery and
// retries. With no page open, only notifications need the updates,
// and those can wait a little, so updates come less often until a page opens, which hears whether
// the update it brings forward is coming and when each update is done. Each page says
// which documents it watches, and hears only of changes to those. A league can keep
// details of the games pages have open, like a box score, read with each update while they need
// it, and run work of its own beside the season's updates, like reading the news. Detail services
// count the reads a job would normally have spared.
// Each update's status goes in `live/status`, and an update that fails is tried again after a wait
// that grows with each failure in a row. Which of the league's feeds are failing, since when and
// why, goes in `live/feeds`, for the Worker's health.

/**
 * What a league's own work gets from the store: its documents, storage of its own under keys the
 * store's paths can't name, the store's reading of the league, the Worker's secrets, and the clock.
 * @typedef {object} JobContext
 * @property {SeasonDocuments} docs
 * @property {(fetchImpl: typeof fetch) => SnapshotLoader<SeasonSnapshot>} createLoadSnapshot
 *   the store's reading of the league, made on the fetch it's handed, so a run that counts its
 *   requests counts these too
 * @property {{ get: (key: string) => Promise<any>, put: (key: string, value: any) => Promise<void>, delete: (key: string) => Promise<boolean>, list: (prefix: string) => Promise<Map<string, any>> }} storage
 * @property {Record<string, any>} env
 * @property {() => number} [remainingRequests] how many history requests this run may still make
 * @property {typeof fetch} fetchImpl
 * @property {() => number} now
 */

/** @typedef {JobContext & { countLeagueRead: (job: string) => Promise<void> }} DetailContext */

/**
 * Work a league's store does on its own schedule. A run that takes long, like asking Claude, goes
 * on beside the season's updates and never holds them up.
 * @typedef {object} BackgroundJob
 * @property {(now: number) => number} chooseDelay the wait from one run's start to the next
 * @property {(context: JobContext) => Promise<void>} [updateHistory] fills history after live jobs and reminders
 * @property {(context: JobContext) => Promise<void>} updateStore one run: brings what the job keeps
 *   in the store up to date
 */

/**
 * The snapshot fields the store itself reads. Other fields belong to the league's callbacks.
 * @typedef {{ season: number, identityRecords?: { records: any[], rejected: number }, failures?: Record<string, string>, nextReadAt?: number }} SeasonSnapshot
 */

/**
 * @template {SeasonSnapshot} Snapshot
 * @typedef {(season: number, options?: { verify?: boolean }) => Promise<Snapshot>} SnapshotLoader
 */

/**
 * The documents a league reads and saves. Their contents belong to the league.
 * @typedef {object} SeasonDocuments
 * @property {(key: string) => Promise<any>} read
 * @property {(collection: string) => Promise<any[]>} list
 * @property {(key: string, document: object) => Promise<void>} write
 * @property {(key: string, change: (document: any) => object | null) => Promise<void>} update
 * @property {(key: string, previous: object, document: object) => Promise<boolean>} replaceIfUnchanged
 * @property {(key: string) => Promise<void>} remove
 */

/**
 * What a league hands the store. A snapshot and the updates used for notifications keep their
 * own shapes through every callback; the store never interprets their league-specific fields.
 * @template {SeasonSnapshot} Snapshot
 * @template Updates
 * @typedef {object} League
 * @property {(storage: import("./feed-keeper.js").FeedStorage, fetchImpl: typeof fetch, readDoc: SeasonDocuments["read"]) => SnapshotLoader<Snapshot>} createLoadSnapshot
 *   reads the league through `fetchImpl`, keeping what it may read again in `storage`
 * @property {(loadSnapshot: SnapshotLoader<Snapshot>, now: number) => Promise<Snapshot>} loadCurrentSnapshot
 * @property {(docs: SeasonDocuments, season: number) => Promise<Updates>} readUpdates
 * @property {(docs: SeasonDocuments, snapshot: Snapshot) => Promise<void>} saveSnapshot
 * @property {(snapshot: Snapshot) => Record<string, string>} describeSnapshotStatus
 * @property {(snapshot: Snapshot) => Record<string, string>} [listFeedFailures] why each of the
 *   league's feeds that failed while a snapshot was read did, by the feed's name, when that isn't
 *   all of the snapshot's `failures`
 * @property {Record<string, string>} [statusFields] the league's own fields of the saved status,
 *   each as it reads with nothing to report
 * @property {(snapshot: Snapshot, now: number) => number} choosePollDelay the wait until the next
 *   update
 * @property {(change: { before: Updates, after: Updates, snapshot: Snapshot, now: number }) => object[]} listNotifications
 * @property {(snapshot: Snapshot) => ReturnType<typeof import("../page/reminder-games.js").listTimedReminderGames>} [listReminderGames]
 * @property {string} [detailsCollection] where the details of the games pages have open are kept
 * @property {(options: { fetchImpl: typeof fetch }) => (id: string, snapshot: Snapshot, stored: any, readDoc: SeasonDocuments["read"]) => Promise<object | null>} [createLoadDetails]
 *   reads a game's details, or answers null while it needs none
 * @property {(context: DetailContext) => (url: URL) => Promise<Response | null>} [createReadDetail]
 * @property {Record<string, BackgroundJob>} [backgroundJobs]
 * @property {import("./identity-documents.js").IdentityPolicy} [identity]
 * @property {string | null} [release] the commit the Worker was built from, or null outside a
 *   build
 */

export const LEAGUE_READS_COUNT = "leagueReads";
const MAX_LISTED = 100;
const STATUS_KEY = "live/status";
// Which season the league's updates are for, so pages never go by their own clocks.
const CURRENT_SEASON_KEY = "live/current";
const FEEDS_KEY = "live/feeds";
// The whole league failing to load counts as a feed of its own beside the ones a snapshot names.
const LEAGUE_FEED = "league";
const BLANK_STATUS = { error: "", detail: "", write: "" };
const RETRY_MS = [30e3, 60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3];
const UNWATCHED_DELAY_MS = 50e3;
// A page that opens on a season this old has the update it would have had if it had been open.
const STALE_MS = 15 * 60e3;
// When the last update ran, how long it said to wait, and when the next is due, under a key the
// store's paths can't name.
const SCHEDULE_KEY = "poll:schedule";
const MAX_WATCHED = 50;

/**
 * Where the store marks a job's run as under way, until it ends.
 * @param {string} name
 */
const nameRunningKey = (name) => `job-running:${name}`;

/**
 * Where a job's storage keeps a detail service's count.
 * @param {string} name
 */
export const nameCountKey = (name) => `count:${name}`;

const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

function readPath(pathname) {
  const [, root, collection, id, ...rest] = pathname.split("/");
  const isValid =
    root === "store" &&
    isStoreName(collection) &&
    (id === undefined || isStoreName(id)) &&
    !rest.length;
  return isValid ? { collection, id } : null;
}

// A status saved before its league had a field reads that field as blank.
const isSameStatus = (stored, current) =>
  !!stored && Object.entries(current).every(([field, value]) => (stored[field] ?? "") === value);

const isWatchedPath = (path) => {
  const text = String(path);
  return isStoreDocumentPath(text) || (text.endsWith("/") && isStoreName(text.slice(0, -1)));
};

// What a page says it watches: documents by path, and collections by name and a slash.
function readWatching(message) {
  let body;
  try {
    body = JSON.parse(String(message));
  } catch {
    return null;
  }
  const watching = body?.watching;
  const isValid =
    Array.isArray(watching) && watching.length <= MAX_WATCHED && watching.every(isWatchedPath);
  return isValid ? watching : null;
}

// A page that hasn't said what it watches hears of every change.
const listWatched = (socket) => socket.deserializeAttachment?.()?.watching ?? null;

function isWatching(socket, path) {
  const watching = listWatched(socket);
  return (
    !watching ||
    watching.some((entry) => entry === path || (entry.endsWith("/") && path.startsWith(entry)))
  );
}

// What a league's reads keep between updates, under keys the store's paths can't name.
/**
 * @param {any} storage
 * @param {{ forgetIdentity: (key: string) => Promise<unknown>, noteIdentityAnswer: (key: string, value: any) => Promise<unknown> }} identity
 */
const createFeedStorage = (storage, { forgetIdentity, noteIdentityAnswer }) => ({
  get: (key) => storage.get(nameStoredFeedKey(key)),
  put: async (key, value) => {
    await storage.put(nameStoredFeedKey(key), value);
    await noteIdentityAnswer(nameStoredFeedKey(key), value);
  },
  delete: async (key) => {
    await storage.delete(nameStoredFeedKey(key));
    await forgetIdentity(nameStoredFeedKey(key));
  },
});

function openWatchSocket(ctx) {
  const [client, server] = Object.values(new WebSocketPair());
  ctx.acceptWebSocket(server);
  return { socket: server, response: new Response(null, { status: 101, webSocket: client }) };
}

/**
 * Tells a page whether the store is updating the season, so a page that opens can wait for that
 * update rather than draw what the store holds and then draw again.
 * @param {{ send: (message: string) => void }} socket
 * @param {boolean} isUpdating
 */
function sendUpdating(socket, isUpdating) {
  try {
    socket.send(JSON.stringify({ updating: isUpdating }));
  } catch {
    // A socket that closed mid-send reconnects and hears it again.
  }
}

/**
 * @template {SeasonSnapshot} Snapshot
 * @template Updates
 * @param {League<Snapshot, Updates>} league
 */
export function createSeasonStore(league) {
  const release = league.release ?? null;
  const listFeedFailures =
    league.listFeedFailures ?? ((/** @type {Snapshot} */ snapshot) => snapshot.failures ?? {});

  /** @param {{ release?: string | null } | undefined} schedule */
  const isFromEarlierRelease = (schedule) => !!schedule && (schedule.release ?? null) !== release;

  return class SeasonStore {
    constructor(
      ctx,
      env,
      {
        openSocket = openWatchSocket,
        now = () => Date.now(),
        fetchImpl = (input, init) => fetch(input, init),
        createLoadSnapshot = (/** @type {typeof fetch} */ fetchWith) =>
          league.createLoadSnapshot(
            createFeedStorage(ctx.storage, {
              forgetIdentity: async (key) =>
                await this.identities?.forgetSource(key).catch(() => {}),
              noteIdentityAnswer: async (key, value) =>
                await this.identities?.noteFeedAnswer(key, value),
            }),
            fetchWith,
            (key) => ctx.storage.get(key),
          ),
        loadDetails = undefined,
      } = {},
    ) {
      this.ctx = ctx;
      this.identities = league.identity
        ? createIdentityDocuments(ctx.storage, league.identity, now)
        : null;
      this.env = env;
      this.requestCount = 0;
      this.fetchImpl = (input, init) => {
        this.requestCount += 1;
        return fetchImpl(input, init);
      };
      this.historyRun = null;
      this.historyGeneration = null;
      this.alarmGeneration = 0;
      /** @type {Map<string, Promise<void>>} */
      this.jobRuns = new Map();
      this.openSocket = openSocket;
      this.createLoadSnapshot = createLoadSnapshot;
      this.loadSnapshot = createLoadSnapshot(this.fetchImpl);
      this.loadDetails =
        loadDetails === undefined
          ? (league.createLoadDetails?.({ fetchImpl: this.fetchImpl }) ?? null)
          : loadDetails;
      this.now = now;
      this.hasAlarm = false;
      this.failures = 0;
      this.push = createPushService({ storage: ctx.storage, now, fetchImpl: this.fetchImpl });
      this.reminders = createGameReminders({
        storage: ctx.storage,
        push: this.push,
        now,
        verify: () => this.verifyReminderGames(),
      });
      /** @type {Map<string, Promise<void>>} */
      this.docUpdates = new Map();
      this.countUpdates = new Map();
      /** @type {SeasonDocuments} */
      this.docs = {
        read: async (key) => (await ctx.storage.get(key)) ?? null,
        list: async (collection) => [
          ...(await ctx.storage.list({ prefix: `${collection}/` })).values(),
        ],
        write: (key, doc) => this.putDoc(key, doc),
        update: (key, change) => this.updateDoc(key, change),
        replaceIfUnchanged: (key, previous, document) =>
          this.replaceDocIfUnchanged(key, previous, document),
        remove: (key) => this.deleteDoc(key),
      };
      this.readDetail = league.createReadDetail?.({
        docs: this.docs,
        storage: this.createJobStorage("details"),
        countLeagueRead: async (job) => {
          await this.incrementJobCount(job, LEAGUE_READS_COUNT);
        },
        createLoadSnapshot: this.createLoadSnapshot,
        env,
        fetchImpl: this.fetchImpl,
        now,
      });
    }

    async fetch(request) {
      await this.startUpdating();
      const { pathname, searchParams } = new URL(request.url);
      if (pathname === "/watch") return this.acceptWatcher(request);
      if (pathname.startsWith("/push/")) {
        const response = await this.push.serveRequest(request, pathname);
        if (response.ok && ["PUT", "DELETE"].includes(request.method)) {
          await this.reminders.refreshDevices();
          await this.armReminderAlarm();
        }
        return response;
      }
      if (this.readDetail && !pathname.startsWith("/store/")) {
        if (request.method !== "GET") return respondMethodNotAllowed(["GET"]);
        const response = await this.readDetail(new URL(request.url));
        if (response) return response;
      }
      const path = readPath(pathname);
      if (!path) return respondError(404, "not_found", "No such path.");
      if (request.method !== "GET") return respondMethodNotAllowed(["GET"]);
      if (path.id === undefined) return this.listDocs(path.collection, searchParams);
      return this.readDoc(`${path.collection}/${path.id}`);
    }

    async acceptWatcher(request) {
      if (request.headers.get("upgrade") !== "websocket")
        return respondError(426, "upgrade_required", "Open this path as a WebSocket.");
      const { socket, response } = this.openSocket(this.ctx);
      sendUpdating(socket, await this.bringUpdateForward());
      return response;
    }

    // The update an open page would have had comes now, rather than when the store, with no page
    // open, would next have looked. Returns whether that update is due at once, as it is for a
    // season the last release updated.
    async bringUpdateForward() {
      const schedule = await this.ctx.storage.get(SCHEDULE_KEY);
      if (!schedule) return false;
      const now = this.now();
      const dueAt = Math.max(now, schedule.at + Math.min(schedule.delay, STALE_MS));
      if (!(schedule.dueAt <= dueAt))
        await this.ctx.storage.put(SCHEDULE_KEY, { ...schedule, dueAt });
      const alarmAt = await this.ctx.storage.getAlarm();
      if (alarmAt === null || alarmAt > dueAt) await this.ctx.storage.setAlarm(dueAt);
      return dueAt <= now || isFromEarlierRelease(schedule);
    }

    incrementJobCount(job, name) {
      const key = `${job}:${name}`;
      const pending = (this.countUpdates.get(key) ?? Promise.resolve()).then(async () => {
        const storage = this.createJobStorage(job);
        const count = ((await storage.get(nameCountKey(name))) ?? 0) + 1;
        await storage.put(nameCountKey(name), count);
        return count;
      });
      this.countUpdates.set(
        key,
        pending.catch(() => {}),
      );
      return pending;
    }

    async listDocs(collection, searchParams) {
      const requested = Number(searchParams.get("limit")) || MAX_LISTED;
      const limit = Math.min(Math.max(requested, 1), MAX_LISTED);
      const stored = await this.ctx.storage.list({ prefix: `${collection}/`, limit });
      const docs = [...stored].map(([key, data]) => ({
        id: key.slice(collection.length + 1),
        data,
      }));
      return respondJson({ docs });
    }

    async readDoc(key) {
      const data =
        key === "health/status"
          ? {
              feeds: (await this.ctx.storage.get(FEEDS_KEY))?.failing ?? {},
              ...(this.identities && { identity: await this.identities.readStatus() }),
            }
          : await this.ctx.storage.get(key);
      return respondJson({ data: data ?? null });
    }

    async putDoc(key, doc) {
      const previous = await this.ctx.storage.get(key);
      const prepared = this.identities
        ? await this.identities.prepareDocument(key, doc, previous)
        : doc;
      const data = sortKeys(prepared);
      if (isSameJson(previous, data)) return;
      await this.ctx.storage.put(key, data);
      this.announceChange(key, data);
    }

    // Changes to a document more than one of the store's runs write, like a season's record, which
    // its updates and a job both write, go one at a time, each on what the one before left, so a
    // run never writes back a copy it read before another's change. `change` answers the document
    // to save, or null to leave it as it is.
    /**
     * @param {string} key
     * @param {(doc: any) => any} change
     */
    updateDoc(key, change) {
      const updating = (this.docUpdates.get(key) ?? Promise.resolve()).then(async () => {
        const doc = change((await this.ctx.storage.get(key)) ?? null);
        if (doc) await this.putDoc(key, doc);
      });
      this.docUpdates.set(
        key,
        updating.catch(() => {}),
      );
      return updating;
    }

    async replaceDocIfUnchanged(key, previous, document) {
      const data = sortKeys(document);
      let changed = false;
      const replacing = (this.docUpdates.get(key) ?? Promise.resolve()).then(() =>
        this.ctx.storage.transaction(async (transaction) => {
          const latest = await transaction.get(key);
          if (!isSameJson(latest, previous)) return false;
          if (!isSameJson(latest, data)) {
            await transaction.put(key, data);
            changed = true;
          }
          return true;
        }),
      );
      this.docUpdates.set(
        key,
        replacing.then(
          () => {},
          () => {},
        ),
      );
      const matched = await replacing;
      if (changed) this.announceChange(key, data);
      return matched;
    }

    async deleteDoc(key) {
      await this.ctx.storage.delete(key);
      await this.identities?.forgetSource(key).catch(() => {});
      this.announceChange(key, null);
    }

    // A stored alarm outlives deploys, so this starts the updates only the first time, and brings
    // the alarm forward for a job a deploy added, or for the season a deploy hasn't updated yet,
    // rather than leaving it until the last version's alarm comes due.
    async startUpdating() {
      if (this.hasAlarm) return;
      const alarmAt = await this.ctx.storage.getAlarm();
      if (alarmAt === null || (alarmAt > this.now() && (await this.isBehindDeploy())))
        await this.ctx.storage.setAlarm(this.now());
      this.hasAlarm = true;
    }

    async isBehindDeploy() {
      const schedule = await this.ctx.storage.get(SCHEDULE_KEY);
      return isFromEarlierRelease(schedule) || (await this.hasUnstartedJob());
    }

    async hasUnstartedJob() {
      const names = Object.keys(league.backgroundJobs ?? {});
      const dueTimes = await Promise.all(
        names.map((name) => this.ctx.storage.get(`job-due:${name}`)),
      );
      return dueTimes.some((dueAt) => dueAt === undefined);
    }

    // One alarm serves the season and every background job, each when it's due. An alarm whose
    // storage failed is set again for a retry, since one never set would stop every update.
    async alarm() {
      const now = this.now();
      const generation = ++this.alarmGeneration;
      const requestsBefore = this.requestCount;
      let nextAt = now + RETRY_MS[0];
      try {
        const seasonDueAt = await this.updateSeasonWhenDue(now);
        await this.reminders.checkDue();
        const jobDueTimes = await this.startDueJobs(now);
        this.startHistory(requestsBefore, generation);
        const updatedSeasonAt = (await this.ctx.storage.get(SCHEDULE_KEY))?.dueAt ?? seasonDueAt;
        const reminderAt = await this.reminders.findNextDeadline();
        nextAt = Math.min(
          updatedSeasonAt,
          ...jobDueTimes,
          reminderAt <= this.now() ? this.now() + RETRY_MS[0] : reminderAt,
        );
      } catch (error) {
        console.error(`The store's alarm failed: ${describeError(error)}`);
      } finally {
        await this.ctx.storage.setAlarm(nextAt);
      }
    }

    async armReminderAlarm() {
      const dueAt = await this.reminders.findNextDeadline();
      const alarmAt = await this.ctx.storage.getAlarm();
      if (Number.isFinite(dueAt) && (alarmAt === null || dueAt < alarmAt))
        await this.ctx.storage.setAlarm(Math.max(this.now(), dueAt));
    }

    // A verifying read reads the feeds it verifies again, and a kept answer stands in for one that
    // fails only where it can't send a reminder for a game the league no longer holds, so one that
    // can't verify the games knows less than the last update did, and leaves what that update
    // saved, and its status, as they are.
    async verifyReminderGames() {
      if (!league.listReminderGames) return;
      const snapshot = await this.loadCurrentSnapshot({ verify: true }).catch((error) => {
        console.error(`Verifying the reminders' games failed: ${describeError(error)}`);
        return null;
      });
      if (!snapshot || !league.listReminderGames(snapshot)) {
        if (snapshot?.nextReadAt !== undefined)
          await this.advanceSeasonPoll(snapshot.nextReadAt - this.now());
        await this.reminders.saveGames(null);
        return;
      }
      const { delay } = await this.saveSeason(snapshot, { verify: true });
      await this.advanceSeasonPoll(delay);
    }

    /** @param {number} delay */
    async advanceSeasonPoll(delay) {
      const at = this.now();
      const dueAt = at + this.slowWhenUnwatched(Math.max(0, delay));
      const schedule = await this.ctx.storage.get(SCHEDULE_KEY);
      if (schedule?.dueAt <= dueAt) return;
      await this.ctx.storage.put(SCHEDULE_KEY, { at, delay, dueAt, release });
      const alarmAt = await this.ctx.storage.getAlarm();
      if (alarmAt === null || dueAt < alarmAt) await this.ctx.storage.setAlarm(dueAt);
    }

    /** @param {{ verify?: boolean }} [options] */
    loadCurrentSnapshot({ verify = false } = {}) {
      return league.loadCurrentSnapshot(
        (season) => this.loadSnapshot(season, { verify }),
        this.now(),
      );
    }

    // A schedule saved before it had a due time reads as due, as does one an earlier release saved,
    // so what a deploy saves differently doesn't wait for the last release's schedule.
    async updateSeasonWhenDue(now) {
      const schedule = await this.ctx.storage.get(SCHEDULE_KEY);
      if (schedule?.dueAt > now && !isFromEarlierRelease(schedule)) return schedule.dueAt;
      let delay = RETRY_MS[0];
      try {
        delay = await this.updateSeason();
      } catch (error) {
        // Cloudflare would retry a failed alarm on its own schedule, on top of the one set here.
        console.error(`The season update failed: ${describeError(error)}`);
      }
      const at = this.now();
      const dueAt = at + this.slowWhenUnwatched(delay);
      await this.ctx.storage.put(SCHEDULE_KEY, { at, delay, dueAt, release });
      // An update that changed nothing pushes nothing, so a page waiting for it hears it's done.
      for (const socket of this.ctx.getWebSockets()) sendUpdating(socket, false);
      return dueAt;
    }

    startDueJobs(now) {
      const jobs = Object.entries(league.backgroundJobs ?? {});
      return Promise.all(jobs.map(([name, job]) => this.startJobWhenDue(name, job, now)));
    }

    startHistory(requestsBefore, generation) {
      if (this.historyRun && this.historyGeneration === generation) return;
      const pending = [...(this.historyRun ? [this.historyRun] : []), ...this.jobRuns.values()];
      const history = Promise.allSettled(pending)
        .then(async () => {
          const limit = Math.min(
            HISTORY_REQUESTS_PER_RUN,
            Math.max(0, ALARM_REQUEST_ALLOWANCE - (this.requestCount - requestsBefore)),
          );
          const budget = createRequestBudget(
            this.fetchImpl,
            limit,
            () => generation === this.alarmGeneration,
          );
          try {
            for (const [name, job] of Object.entries(league.backgroundJobs ?? {})) {
              if (!job.updateHistory || !budget.remaining()) continue;
              await job.updateHistory({
                docs: this.docs,
                storage: this.createJobStorage(name),
                createLoadSnapshot: this.createLoadSnapshot,
                env: this.env,
                fetchImpl: budget.fetchImpl,
                remainingRequests: budget.remaining,
                now: this.now,
              });
            }
          } finally {
            await this.identities?.backfillWhenDue(
              this.docs,
              () => generation === this.alarmGeneration,
            );
          }
        })
        .catch((error) => {
          if (!(error instanceof RequestBudgetExhausted))
            console.error(`Filling history failed: ${describeError(error)}`);
        })
        .finally(() => {
          if (this.historyRun === history) {
            this.historyRun = null;
            this.historyGeneration = null;
          }
        });
      this.historyRun = history;
      this.historyGeneration = generation;
      this.ctx.waitUntil?.(history);
    }

    // The next run is set before this one starts, so a run that never ends can't stop the next. A
    // run marked as under way that this object isn't running was lost with an earlier one, as when
    // a deploy restarts it, so it runs again at once rather than at its next turn, but only once,
    // so a run that takes the object down each time waits for its turns.
    async startJobWhenDue(name, job, now) {
      const dueKey = `job-due:${name}`;
      const dueAt = (await this.ctx.storage.get(dueKey)) ?? now;
      const isLost = await this.isRunLost(name);
      if (dueAt > now && !isLost) return dueAt;
      const nextAt = now + job.chooseDelay(now);
      await this.ctx.storage.put(dueKey, nextAt);
      if (!this.jobRuns.has(name))
        this.jobRuns.set(name, this.runJob(name, job, { isRerun: dueAt > now }));
      return nextAt;
    }

    // A lost run that was itself the rerun of a lost one waits for the job's next turn.
    async isRunLost(name) {
      if (this.jobRuns.has(name)) return false;
      const running = await this.ctx.storage.get(nameRunningKey(name));
      return running !== undefined && !running.isRerun;
    }

    async runJob(name, job, { isRerun }) {
      const runningKey = nameRunningKey(name);
      try {
        await this.ctx.storage.put(runningKey, { at: this.now(), isRerun });
        await job.updateStore({
          docs: this.docs,
          storage: this.createJobStorage(name),
          createLoadSnapshot: this.createLoadSnapshot,
          env: this.env,
          fetchImpl: this.fetchImpl,
          now: this.now,
        });
      } catch (error) {
        console.error(`The ${name} job failed: ${describeError(error)}`);
      }
      await this.ctx.storage
        .delete(runningKey)
        .catch((error) => console.error(`Ending the ${name} job failed: ${describeError(error)}`));
      this.jobRuns.delete(name);
    }

    createJobStorage(name) {
      const prefix = `job:${name}:`;
      const { storage } = this.ctx;
      return {
        get: (key) => storage.get(prefix + key),
        put: async (key, value) => {
          const prepared =
            name === "details" && key.startsWith("detail-answer:") && this.identities
              ? await this.identities.prepareDetailAnswer(prefix + key, value)
              : value;
          await storage.put(prefix + key, prepared);
        },
        delete: async (key) => {
          const removed = await storage.delete(prefix + key);
          await this.identities?.forgetSource(prefix + key).catch(() => {});
          return removed;
        },
        list: async (keyPrefix) =>
          new Map(
            [...(await storage.list({ prefix: prefix + keyPrefix }))].map(([key, value]) => [
              key.slice(prefix.length),
              value,
            ]),
          ),
      };
    }

    webSocketMessage(socket, message) {
      const watching = readWatching(message);
      if (watching) socket.serializeAttachment({ watching });
    }

    // Answering a page's close ends the socket, so it no longer counts as a page that's open.
    webSocketClose(socket) {
      try {
        socket.close();
      } catch {
        // The runtime already ended it.
      }
    }

    slowWhenUnwatched(delay) {
      const isWatched = this.ctx.getWebSockets().length > 0;
      return isWatched ? delay : Math.max(delay, UNWATCHED_DELAY_MS);
    }

    async loadAndSaveSeason() {
      let snapshot;
      try {
        snapshot = await this.loadCurrentSnapshot();
      } catch (error) {
        const detail = describeError(error);
        await this.reminders.saveGames(null);
        await this.saveFeedFailures((failing) => ({
          ...listFailureReasons(failing),
          [LEAGUE_FEED]: detail,
        }));
        const delay = await this.recordFailure({ error: "upstream_error", detail });
        return { snapshot: null, delay };
      }
      return this.saveSeason(snapshot);
    }

    /** @param {Snapshot} snapshot @param {{ verify?: boolean }} [options] */
    async saveSeason(snapshot, { verify = false } = {}) {
      await this.saveFeedFailures(() => listFeedFailures(snapshot));
      let before;
      try {
        before = await league.readUpdates(this.docs, snapshot.season);
        await league.saveSnapshot(this.docs, snapshot);
        await this.identities?.saveVendorGames(
          snapshot.identityRecords?.records ?? [],
          snapshot.identityRecords?.rejected ?? 0,
          this.docs,
        );
        await this.saveCurrentSeason(snapshot.season);
      } catch (error) {
        await this.reminders.saveGames(null);
        const delay = await this.recordFailure({ write: describeError(error) });
        return { snapshot: null, delay };
      }
      this.failures = 0;
      // The next update's `before` holds what this one saved, so notifying can't wait on the status.
      await this.notifyUpdates(before, snapshot);
      if (league.listReminderGames)
        await this.reminders.saveGames(league.listReminderGames(snapshot), verify);
      await this.saveStatus(league.describeSnapshotStatus(snapshot));
      return { snapshot, delay: this.chooseNextPollDelay(snapshot) };
    }

    /** @param {Snapshot} snapshot */
    chooseNextPollDelay(snapshot) {
      const now = this.now();
      const feedDelay = Math.max(0, (snapshot.nextReadAt ?? Infinity) - now);
      return Math.min(league.choosePollDelay(snapshot, now), feedDelay);
    }

    // `listFailures` answers why each feed failing now does, from the feeds failing before.
    /** @param {(failing: Record<string, import("./feed-failures.js").FeedFailure>) => Record<string, string>} listFailures */
    async saveFeedFailures(listFailures) {
      const stored = await this.docs.read(FEEDS_KEY);
      const failing = stored?.failing ?? {};
      const current = noteFeedFailures(failing, listFailures(failing), this.now());
      if (!isSameJson(failing, current)) await this.docs.write(FEEDS_KEY, { failing: current });
    }

    // Returns how long to wait before the next update.
    async updateSeason() {
      const { snapshot, delay } = await this.loadAndSaveSeason();
      if (snapshot) await this.refreshWatchedDetails(snapshot);
      return delay;
    }

    /** @param {Snapshot} snapshot */
    async refreshWatchedDetails(snapshot) {
      if (!this.loadDetails) return;
      const prefix = `${league.detailsCollection}/`;
      const paths = this.ctx.getWebSockets().flatMap((socket) => listWatched(socket) ?? []);
      const ids = new Set(
        paths.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length)),
      );
      await Promise.all([...ids].map((id) => this.refreshDetails(id, snapshot)));
    }

    // A game's details that fail to load leave the ones saved, and never hold up the update.
    /** @param {string} id @param {Snapshot} snapshot */
    async refreshDetails(id, snapshot) {
      const key = `${league.detailsCollection}/${id}`;
      try {
        const stored = await this.docs.read(key);
        const details = await this.loadDetails(id, snapshot, stored, this.docs.read);
        if (details && !isSameJson(stored, details)) await this.putDoc(key, details);
      } catch (error) {
        console.error(`Reading ${key} failed: ${describeError(error)}`);
      }
    }

    async saveCurrentSeason(season) {
      const stored = await this.docs.read(CURRENT_SEASON_KEY);
      if (stored?.season !== season) await this.docs.write(CURRENT_SEASON_KEY, { season });
    }

    // A failed notification never holds up the next update.
    /** @param {Updates} before @param {Snapshot} snapshot */
    async notifyUpdates(before, snapshot) {
      try {
        const after = await league.readUpdates(this.docs, snapshot.season);
        const notifications = league.listNotifications({
          before,
          after,
          snapshot,
          now: this.now(),
        });
        if (!notifications.length) return;
        await this.push.sendToAll(notifications);
      } catch (error) {
        console.error(`Notifying failed: ${describeError(error)}`);
      }
    }

    async recordFailure(status) {
      const delay = RETRY_MS[Math.min(this.failures, RETRY_MS.length - 1)];
      this.failures += 1;
      await this.saveStatus(status);
      return delay;
    }

    // Stored so updates that stop can be diagnosed without the Worker's logs.
    async saveStatus(status) {
      const savedAt = this.now();
      const current = { ...BLANK_STATUS, ...league.statusFields, ...status };
      const stored = await this.docs.read(STATUS_KEY);
      if (!isSameStatus(stored, current))
        await this.docs.write(STATUS_KEY, { ...current, at: new Date(savedAt).toISOString() });
    }

    announceChange(path, data) {
      const message = JSON.stringify({ path, data });
      for (const socket of this.ctx.getWebSockets()) {
        if (!isWatching(socket, path)) continue;
        try {
          socket.send(message);
        } catch {
          // A socket that closed mid-send reconnects and reads the document again.
        }
      }
    }
  };
}

const findStore = (env) => env.STORE.get(env.STORE.idFromName("store"));

// Only the page's own origin talks to the store, so it gets no CORS headers.
export async function forwardToStore(request, env, storePath) {
  const url = new URL(request.url);
  url.pathname = storePath;
  try {
    return await findStore(env).fetch(new Request(url, request));
  } catch (error) {
    console.error(`Reaching the store failed: ${describeError(error)}`);
    return respondError(503, "store_unavailable", "Couldn't reach the store. Try again.");
  }
}

/**
 * The store's failing feeds and identity coverage, for the Worker's single reused health read.
 * Throws when the store does not answer.
 * @param {any} env the Worker's bindings
 * @returns {Promise<{ feeds: Record<string, import("./feed-failures.js").FeedFailure>, identity?: any }>}
 */
export const readStoreHealth = async (env) => await readStoreDoc(env, "health/status");

/**
 * A document the store keeps, as null when it has none, for the Worker's own reads.
 * @param {any} env the Worker's bindings
 * @param {string} key a document's path, as rosters/2026-NYL
 */
export async function readStoreDoc(env, key) {
  const response = await findStore(env).fetch(`https://store/store/${key}`);
  if (!response.ok) throw new Error(`The store answered ${response.status} for ${key}`);
  return (await response.json()).data;
}
