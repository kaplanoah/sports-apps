import { isSameJson } from "../page/compare.js";
import { createPushService } from "./push.js";
import { describeError, respondError, respondJson, respondMethodNotAllowed } from "./responses.js";

// An app's saved data, kept in one Durable Object so every device reads the latest write.
// Documents come back with sorted keys, and a missing one reads as null. The page can read any
// document but writes none, since what a viewer chooses stays on their own device.
//
// An alarm keeps the current season up to date from the league while no page is open, and tells
// subscribed devices about new updates. With no page open, only notifications need the updates,
// and those can wait a little, so updates come less often until a page opens, which hears whether
// the update it brings forward is coming and when each update is done. Each page says
// which documents it watches, and hears only of changes to those. A league can keep
// details of the games pages have open, like a box score, read with each update while they need
// it, and run work of its own beside the season's updates, like reading the news. The Worker, and
// never the page, can add to a count a job keeps, like how often a sheet had to read the league.
// Each update's status goes in `live/status`, and an update that fails is tried again after a wait
// that grows with each failure in a row.

/**
 * What a league's own work gets from the store: its documents, storage of its own under keys the
 * store's paths can't name, the store's reading of the league, the Worker's secrets, and the clock.
 * @typedef {object} JobContext
 * @property {any} docs
 * @property {(fetchImpl: typeof fetch) => (season: number) => Promise<any>} createLoadSnapshot
 *   the store's reading of the league, made on the fetch it's handed, so a run that counts its
 *   requests counts these too
 * @property {{ get: (key: string) => Promise<any>, put: (key: string, value: any) => Promise<void>, delete: (key: string) => Promise<boolean>, list: (prefix: string) => Promise<Map<string, any>> }} storage
 * @property {Record<string, any>} env
 * @property {typeof fetch} fetchImpl
 * @property {() => number} now
 */

/**
 * Work a league's store does on its own schedule. A run that takes long, like asking Claude, goes
 * on beside the season's updates and never holds them up.
 * @typedef {object} BackgroundJob
 * @property {(now: number) => number} chooseDelay the wait from one run's start to the next
 * @property {(context: JobContext) => Promise<void>} updateStore one run: brings what the job keeps
 *   in the store up to date
 */

/**
 * What a league hands the store.
 * @typedef {object} League
 * @property {(storage: import("./feed-keeper.js").FeedStorage, fetchImpl: typeof fetch) => (season: number) => Promise<any>} createLoadSnapshot
 *   reads the league through `fetchImpl`, keeping what it may read again in `storage`
 * @property {(loadSnapshot: (season: number) => Promise<any>, now: number) => Promise<any>} loadCurrentSnapshot
 * @property {(docs: any, season: number) => Promise<any>} readUpdates
 * @property {(docs: any, snapshot: any) => Promise<void>} saveSnapshot
 * @property {(snapshot: any) => Record<string, string>} describeSnapshotStatus
 * @property {Record<string, string>} [statusFields] the league's own fields of the saved status,
 *   each as it reads with nothing to report
 * @property {(snapshot: any, now: number) => number} choosePollDelay the wait until the next
 *   update
 * @property {(change: { before: any, after: any, snapshot: any, now: number }) => object[]} listNotifications
 * @property {string} [detailsCollection] where the details of the games pages have open are kept
 * @property {() => (id: string, snapshot: any, stored: any) => Promise<any>} [createLoadDetails]
 *   reads a game's details, or answers null while it needs none
 * @property {Record<string, BackgroundJob>} [backgroundJobs]
 * @property {string | null} [release] the commit the Worker was built from, or null outside a
 *   build
 */

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_LISTED = 100;
const STATUS_KEY = "live/status";
// Which season the league's updates are for, so pages never go by their own clocks.
const CURRENT_SEASON_KEY = "live/current";
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
 * Where a job's storage keeps a count the Worker adds to.
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
    NAME_PATTERN.test(collection || "") &&
    (id === undefined || NAME_PATTERN.test(id)) &&
    !rest.length;
  return isValid ? { collection, id } : null;
}

// A status saved before its league had a field reads that field as blank.
const isSameStatus = (stored, current) =>
  !!stored && Object.entries(current).every(([field, value]) => (stored[field] ?? "") === value);

const isWatchedPath = (path) => {
  const [collection, id, ...rest] = String(path).split("/");
  return NAME_PATTERN.test(collection) && (id === "" || NAME_PATTERN.test(id)) && !rest.length;
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
const createFeedStorage = (storage) => ({
  get: (key) => storage.get(`feed:${key}`),
  put: (key, value) => storage.put(`feed:${key}`, value),
  delete: (key) => storage.delete(`feed:${key}`),
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

/** @param {League} league */
export function createSeasonStore(league) {
  const release = league.release ?? null;

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
          league.createLoadSnapshot(createFeedStorage(ctx.storage), fetchWith),
        loadDetails = league.createLoadDetails?.() ?? null,
      } = {},
    ) {
      this.ctx = ctx;
      this.env = env;
      this.fetchImpl = fetchImpl;
      /** @type {Map<string, Promise<void>>} */
      this.jobRuns = new Map();
      this.openSocket = openSocket;
      this.createLoadSnapshot = createLoadSnapshot;
      this.loadSnapshot = createLoadSnapshot(fetchImpl);
      this.loadDetails = loadDetails;
      this.now = now;
      this.hasAlarm = false;
      this.failures = 0;
      this.push = createPushService({ storage: ctx.storage, now, fetchImpl });
      /** @type {Map<string, Promise<void>>} */
      this.docUpdates = new Map();
      this.docs = {
        read: async (key) => (await ctx.storage.get(key)) ?? null,
        list: async (collection) => [
          ...(await ctx.storage.list({ prefix: `${collection}/` })).values(),
        ],
        write: (key, doc) => this.putDoc(key, doc),
        update: (key, change) => this.updateDoc(key, change),
        remove: (key) => this.deleteDoc(key),
      };
    }

    async fetch(request) {
      await this.startUpdating();
      const { pathname, searchParams } = new URL(request.url);
      if (pathname === "/watch") return this.acceptWatcher(request);
      if (pathname.startsWith("/push/")) return this.push.serveRequest(request, pathname);
      if (pathname.startsWith("/count/")) return this.addToCount(request, pathname);
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

    // Kept in the job's own storage, where its next run reads it.
    async addToCount(request, pathname) {
      if (request.method !== "POST") return respondMethodNotAllowed(["POST"]);
      const [, , job, name, ...rest] = pathname.split("/");
      const isJob = Object.hasOwn(league.backgroundJobs ?? {}, job);
      if (!isJob || !NAME_PATTERN.test(name ?? "") || rest.length)
        return respondError(404, "not_found", "No such count.");
      const storage = this.createJobStorage(job);
      const count = ((await storage.get(nameCountKey(name))) ?? 0) + 1;
      await storage.put(nameCountKey(name), count);
      return respondJson({ count });
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
      const data = await this.ctx.storage.get(key);
      return respondJson({ data: data ?? null });
    }

    async putDoc(key, doc) {
      const data = sortKeys(doc);
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

    async deleteDoc(key) {
      await this.ctx.storage.delete(key);
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
      let nextAt = now + RETRY_MS[0];
      try {
        const seasonDueAt = await this.updateSeasonWhenDue(now);
        const jobDueTimes = await this.startDueJobs(now);
        nextAt = Math.min(seasonDueAt, ...jobDueTimes);
      } catch (error) {
        console.error(`The store's alarm failed: ${describeError(error)}`);
      } finally {
        await this.ctx.storage.setAlarm(nextAt);
      }
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
        put: (key, value) => storage.put(prefix + key, value),
        delete: (key) => storage.delete(prefix + key),
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

    // Returns how long to wait before the next update.
    async updateSeason() {
      let snapshot;
      try {
        snapshot = await league.loadCurrentSnapshot(this.loadSnapshot, this.now());
      } catch (error) {
        return this.recordFailure({ error: "upstream_error", detail: describeError(error) });
      }
      let before;
      try {
        before = await league.readUpdates(this.docs, snapshot.season);
        await league.saveSnapshot(this.docs, snapshot);
        await this.saveCurrentSeason(snapshot.season);
      } catch (error) {
        return this.recordFailure({ write: describeError(error) });
      }
      this.failures = 0;
      // The next update's `before` holds what this one saved, so notifying can't wait on the status.
      await this.notifyUpdates(before, snapshot);
      await this.saveStatus(league.describeSnapshotStatus(snapshot));
      await this.refreshWatchedDetails(snapshot);
      return league.choosePollDelay(snapshot, this.now());
    }

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
    async refreshDetails(id, snapshot) {
      const key = `${league.detailsCollection}/${id}`;
      try {
        const stored = await this.docs.read(key);
        const details = await this.loadDetails(id, snapshot, stored);
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
export function forwardToStore(request, env, storePath) {
  const url = new URL(request.url);
  url.pathname = storePath;
  return findStore(env).fetch(new Request(url, request));
}

/**
 * Whether the store answers, for the Worker's health.
 * @param {any} env the Worker's bindings
 */
export async function isStoreAnswering(env) {
  const response = await findStore(env).fetch(`https://store/store/${STATUS_KEY}`);
  return response.ok;
}

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

/**
 * Adds one to a count a background job keeps, for the Worker's own routes.
 * @param {any} env the Worker's bindings
 * @param {string} job the job's name, as the league's `backgroundJobs` keys it
 * @param {string} name what it counts
 */
export async function addToJobCount(env, job, name) {
  const response = await findStore(env).fetch(`https://store/count/${job}/${name}`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(`The store answered ${response.status} for ${job}'s ${name}`);
}
