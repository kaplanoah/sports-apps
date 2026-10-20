// The page's saved data, kept by the Worker that serves the page and pushed to it as it changes.
import { reloadWhenSignedOut } from "./access.js";
import { UPDATING_WAIT_MS } from "./catch-up-note.js";
import { noteStep } from "./diagnostics.js";
import { readWorkerError } from "./worker-error.js";

const RECONNECT_FIRST_MS = 1000;
// Pull to refresh holds the page down while the store catches up, but no longer than this.
const CATCH_UP_WAIT_MS = 10 * 1000;
const RECONNECT_MAX_MS = 30 * 1000;
// A proxy or captive portal can hold a socket's handshake open without ever answering it.
const HANDSHAKE_WAIT_MS = 3 * 1000;

class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Documents come back read-only, so the page copies before it changes one.
function freezeDeeply(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeeply);
    Object.freeze(value);
  }
  return value;
}

function createSnapshot(id, data) {
  const frozen = freezeDeeply(data ?? null);
  return { id, exists: frozen !== null, data: () => frozen ?? undefined };
}

const readId = (path) => path.slice(path.lastIndexOf("/") + 1);
const readCollectionName = (path) => path.slice(0, path.lastIndexOf("/"));
const compareIds = ([first], [second]) => (first < second ? -1 : 1);

async function requestJson(url) {
  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (error) {
    throw new StoreError("unavailable", error instanceof Error ? error.message : String(error));
  }
  reloadWhenSignedOut(response);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const { code, message } = readWorkerError(body, response.status, "The store");
    throw new StoreError(code, message);
  }
  // Something between the page and the Worker, like a captive portal, can answer instead.
  if (!body || typeof body !== "object")
    throw new StoreError("bad_payload", "The store's answer couldn't be read.");
  return body;
}

async function readData(url) {
  const body = await requestJson(url);
  if (!("data" in body)) throw new StoreError("bad_payload", "The store's answer had no document.");
  return body.data;
}

async function readDocs(url) {
  const body = await requestJson(url);
  if (!Array.isArray(body.docs))
    throw new StoreError("bad_payload", "The store's answer had no documents.");
  return body.docs;
}

/**
 * @param {{ baseUrl?: URL, isShowing?: () => boolean }} [options] `isShowing` says whether the page
 *   shows a drawing yet, its own or the one it last showed
 */
export function createWorkerStore({
  baseUrl = new URL("./", location.href),
  isShowing = () => false,
} = {}) {
  const listenersByPath = new Map();
  // Each watched collection keeps its documents by id, so a push changes one without a new listing.
  const collectionWatches = new Map();
  let socket = null;
  let isSocketOpen = false;
  let handshakeTimer = null;
  let reconnectTimer = null;
  let reconnectDelay = RECONNECT_FIRST_MS;
  let isCaughtUp = false;
  let hasReadOnOpen = false;
  // The store says as a socket opens whether an update is coming, and says when each is done.
  let isUpdateAwaited = false;
  // While the page catches up with a drawing on the screen, it holds what the store sends until
  // the update the store brought forward has come too, so it draws once, with the latest, rather
  // than what the store held and then the update. It holds no longer than it takes the header to
  // say the page is getting the latest scores, and not at all with nothing drawn.
  /** @type {ReturnType<typeof setTimeout> | null} */
  let holdTimer = null;
  /** @type {Map<string, () => void>} */
  const held = new Map();
  /** @type {(() => void)[]} */
  let afterHandOvers = [];
  /** @type {number | null} */
  let syncedAt = null;
  /** @type {Set<(isCaughtUp: boolean) => void>} */
  const catchUpListeners = new Set();
  // Reads overlap, so one that started before a pushed change, or before a read that already
  // arrived, must not replace it with older data.
  let clock = 0;
  const deliveredAt = new Map();

  const findUrl = (path) => new URL(`store/${path}`, baseUrl);
  const findListUrl = (name, count) => new URL(`store/${name}?limit=${count}`, baseUrl);
  const hasWatchers = () => listenersByPath.size > 0 || collectionWatches.size > 0;

  const isHolding = () => holdTimer !== null && isShowing();

  /**
   * Hands what the store sent to the page, or holds it, keeping only the latest of each.
   * @param {string} key
   * @param {() => void} deliver
   */
  function handOver(key, deliver) {
    if (!isHolding()) deliver();
    else held.set(key, deliver);
  }

  function deliverSnapshot(path, snapshot) {
    noteStep(`Store sent ${path}${snapshot.exists ? "" : ", not found"}`);
    handOver(path, () => {
      for (const listener of listenersByPath.get(path) || []) listener.onNext(snapshot);
    });
  }

  function deliverError(path, error) {
    noteStep(`Store couldn't read ${path}`);
    for (const listener of listenersByPath.get(path) || []) listener.onError(error);
  }

  async function readSnapshot(path) {
    return createSnapshot(readId(path), await readData(findUrl(path)));
  }

  async function refreshPath(path) {
    const startedAt = ++clock;
    try {
      const snapshot = await readSnapshot(path);
      if ((deliveredAt.get(path) || 0) > startedAt) return true;
      deliveredAt.set(path, startedAt);
      deliverSnapshot(path, snapshot);
      return true;
    } catch (error) {
      deliverError(path, error);
      return false;
    }
  }

  function deliverCollection(watch) {
    noteStep(`Store sent ${watch.name}, ${watch.docsById.size} in all`);
    handOver(`${watch.name}/`, () => {
      const docs = [...watch.docsById]
        .sort(compareIds)
        .map(([id, data]) => createSnapshot(id, data));
      for (const listener of watch.listeners) listener.onNext({ docs });
    });
  }

  function releaseHeld() {
    clearTimeout(holdTimer ?? undefined);
    holdTimer = null;
    if (held.size) noteStep(`Store handed over the ${held.size} it held for its update`);
    const deliveries = [...held.values()];
    held.clear();
    for (const deliver of deliveries) deliver();
    const callbacks = afterHandOvers;
    afterHandOvers = [];
    for (const callback of callbacks) callback();
  }

  // Set before the page says it's behind, so a hold that runs out does before the header's line
  // that it's getting the latest scores would show.
  function startHolding() {
    clearTimeout(holdTimer ?? undefined);
    holdTimer = setTimeout(() => {
      releaseHeld();
      settleCatchUp();
    }, UPDATING_WAIT_MS);
  }

  async function refreshCollection(name) {
    const watch = collectionWatches.get(name);
    const startedAt = ++clock;
    try {
      const docs = await readDocs(findListUrl(name, watch.limit));
      if (collectionWatches.get(name) !== watch || watch.listedAt > startedAt) return true;
      watch.listedAt = startedAt;
      const docsById = new Map(docs.map(({ id, data }) => [id, data]));
      for (const [id, pushed] of watch.pushes) {
        if (pushed.at < startedAt) continue;
        if (pushed.data === null) docsById.delete(id);
        else docsById.set(id, pushed.data);
      }
      watch.docsById = docsById;
      deliverCollection(watch);
      return true;
    } catch (error) {
      for (const listener of watch.listeners) listener.onError(error);
      return false;
    }
  }

  // The Worker sends the page only changes to what it watches, so the page says what that is as
  // its socket opens and whenever it changes.
  function sendWatching() {
    if (!isSocketOpen) return;
    const collections = [...collectionWatches.keys()].map((name) => `${name}/`);
    try {
      socket.send(JSON.stringify({ watching: [...listenersByPath.keys(), ...collections] }));
    } catch {
      // A socket that closed mid-send reconnects and says it again.
    }
  }

  /** @returns {Promise<boolean>} whether every read answered */
  const refreshWatchedPaths = async () => {
    const answers = await Promise.all([
      ...[...listenersByPath.keys()].map(refreshPath),
      ...[...collectionWatches.keys()].map(refreshCollection),
    ]);
    return answers.every(Boolean);
  };

  /** @param {boolean} caughtUp */
  function announceCatchUp(caughtUp) {
    isCaughtUp = caughtUp;
    for (const listener of catchUpListeners) listener(caughtUp);
  }

  function markCaughtUp() {
    releaseHeld();
    reconnectDelay = RECONNECT_FIRST_MS;
    syncedAt = Date.now();
    if (!isCaughtUp) announceCatchUp(true);
  }

  // The page has caught up once every watched document has been read and its socket is open to
  // hear what changes next, and, while it holds what the store sends, once the update the store
  // said is coming is done.
  function settleCatchUp() {
    if (!isCaughtUp && hasReadOnOpen && !(isUpdateAwaited && isHolding())) markCaughtUp();
  }

  // A page that was caught up had what the store holds until the moment it fell behind.
  function markBehind() {
    if (!isCaughtUp) return;
    syncedAt = Date.now();
    startHolding();
    announceCatchUp(false);
  }

  // A socket can hang without opening or closing, as on a phone that has just woken, so reads that
  // fail give it up for a new one.
  function abandonSocket() {
    const stuck = socket;
    scheduleReconnect();
    stuck?.close();
  }

  /** @param {WebSocket | null} reader the socket the reads were made for */
  async function readWatchedPaths(reader) {
    const hasRead = await refreshWatchedPaths();
    if (socket !== reader) return;
    if (!hasRead) abandonSocket();
    else if (isSocketOpen) {
      hasReadOnOpen = true;
      settleCatchUp();
    }
  }

  // Before the first listing arrives, the listing takes the push in instead.
  function applyCollectionPush(path, data) {
    const watch = collectionWatches.get(readCollectionName(path));
    if (!watch) return;
    const id = readId(path);
    watch.pushes.set(id, { at: clock, data });
    if (!watch.docsById) return;
    if (data === null) watch.docsById.delete(id);
    else watch.docsById.set(id, data);
    deliverCollection(watch);
  }

  /** @param {{ path: string, data: any }} push */
  function receivePush({ path, data }) {
    deliveredAt.set(path, ++clock);
    deliverSnapshot(path, createSnapshot(readId(path), data));
    applyCollectionPush(path, data);
  }

  // While the socket is down, each reconnect attempt also reads the watched documents again.
  function scheduleReconnect() {
    socket = null;
    isSocketOpen = false;
    hasReadOnOpen = false;
    markBehind();
    clearTimeout(handshakeTimer);
    handshakeTimer = null;
    if (reconnectTimer || !hasWatchers()) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      refreshWatchedPaths();
      openSocket();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  function openSocket() {
    const url = new URL("watch", baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const opened = new WebSocket(url);
    socket = opened;
    isSocketOpen = false;
    hasReadOnOpen = false;
    isUpdateAwaited = true;
    clearTimeout(handshakeTimer);
    handshakeTimer = setTimeout(() => {
      handshakeTimer = null;
      readWatchedPaths(opened);
    }, HANDSHAKE_WAIT_MS);
    opened.addEventListener("open", () => {
      if (socket !== opened) return;
      noteStep("Store connected");
      isSocketOpen = true;
      clearTimeout(handshakeTimer);
      handshakeTimer = null;
      sendWatching();
      readWatchedPaths(opened);
    });
    opened.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!("updating" in message)) receivePush(message);
      else if (socket === opened) noteUpdating(message.updating);
    });
    opened.addEventListener("close", () => {
      noteStep("Store connection closed");
      if (socket === opened) scheduleReconnect();
    });
  }

  // The store says each update is done, but only one the page waits on is worth a step.
  /** @param {boolean} isUpdating */
  function noteUpdating(isUpdating) {
    if (!isCaughtUp) noteStep(isUpdating ? "Store is updating" : "Store is up to date");
    isUpdateAwaited = isUpdating;
    if (!isUpdating) settleCatchUp();
  }

  // A phone suspends a page in the background, and its socket can still look open after the
  // connection is gone, never to push again, so a page coming back reads again as a new socket
  // opens. A page still caught up as it left last had what the store holds when it left.
  /** @param {number} [awayMs] how long the page was away */
  function catchUp(awayMs = 0) {
    if (!hasWatchers()) return;
    if (isCaughtUp) syncedAt = Date.now() - awayMs;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectDelay = RECONNECT_FIRST_MS;
    const stale = socket;
    socket = null;
    isSocketOpen = false;
    stale?.close();
    startHolding();
    announceCatchUp(false);
    openSocket();
  }

  // A page no one is looking at closes its socket, so the Worker can update less often, and
  // catches up when it's back.
  function pause() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearTimeout(handshakeTimer);
    handshakeTimer = null;
    const open = socket;
    socket = null;
    isSocketOpen = false;
    hasReadOnOpen = false;
    open?.close();
    markBehind();
  }

  /**
   * Calls `onChange` with whether the page has what the store holds, as that changes, and with
   * false each time the page comes back, since it may have missed changes while it was away.
   * @param {(isCaughtUp: boolean) => void} onChange
   */
  function watchCatchUp(onChange) {
    catchUpListeners.add(onChange);
    onChange(isCaughtUp);
  }

  /** When the page last had what the store holds, or null before it first caught up. */
  const readSyncedAt = () => syncedAt;

  /**
   * Resolves with true once the page has caught up, or with false once it has waited
   * CATCH_UP_WAIT_MS.
   * @returns {Promise<boolean>}
   */
  function waitForCatchUp() {
    if (isCaughtUp) return Promise.resolve(true);
    return new Promise((resolve) => {
      const finish = (/** @type {boolean} */ hasCaughtUp) => {
        clearTimeout(timer);
        catchUpListeners.delete(listener);
        resolve(hasCaughtUp);
      };
      const listener = (/** @type {boolean} */ caughtUp) => {
        if (caughtUp) finish(true);
      };
      const timer = setTimeout(() => finish(false), CATCH_UP_WAIT_MS);
      catchUpListeners.add(listener);
    });
  }

  // A read sent before the socket opens can miss a change saved before the socket could hear of
  // it, so while a socket's handshake is under way, the read waits for the one the socket makes
  // as it opens, or for the one made once the handshake has taken too long.
  function readWhenWatching(refresh) {
    if (!socket && !reconnectTimer) openSocket();
    else if (!handshakeTimer) refresh();
  }

  function watchPath(path, onNext, onError) {
    const listener = { onNext, onError };
    if (!listenersByPath.has(path)) {
      listenersByPath.set(path, new Set());
      sendWatching();
    }
    listenersByPath.get(path).add(listener);
    readWhenWatching(() => refreshPath(path));
    return () => {
      const listeners = listenersByPath.get(path);
      listeners?.delete(listener);
      if (listeners && !listeners.size) {
        listenersByPath.delete(path);
        sendWatching();
      }
    };
  }

  function watchCollection(name, limit, onNext, onError) {
    const listener = { onNext, onError };
    if (!collectionWatches.has(name)) {
      collectionWatches.set(name, {
        name,
        limit,
        listeners: new Set(),
        docsById: null,
        listedAt: 0,
        pushes: new Map(),
      });
      sendWatching();
    }
    collectionWatches.get(name).listeners.add(listener);
    readWhenWatching(() => refreshCollection(name));
    return () => {
      const watch = collectionWatches.get(name);
      watch?.listeners.delete(listener);
      if (watch && !watch.listeners.size) {
        collectionWatches.delete(name);
        sendWatching();
      }
    };
  }

  function doc(path) {
    return {
      id: readId(path),
      path,
      get: () => readSnapshot(path),
      onSnapshot: (onNext, onError = () => {}) => watchPath(path, onNext, onError),
    };
  }

  function collection(name) {
    return {
      limit: (count) => ({
        get: async () => {
          const docs = await readDocs(findListUrl(name, count));
          return { docs: docs.map(({ id, data }) => createSnapshot(id, data)) };
        },
        onSnapshot: (onNext, onError = () => {}) => watchCollection(name, count, onNext, onError),
      }),
    };
  }

  /**
   * Calls `callback` once the page has what the store sent since it fell behind: at once while it
   * holds nothing back, or as it hands over what it held, before it says it has caught up, so a
   * redraw then is the one the header's sweep shows.
   * @param {() => void} callback
   */
  function afterHandOver(callback) {
    if (isHolding()) afterHandOvers.push(callback);
    else callback();
  }

  startHolding();

  return {
    doc,
    collection,
    catchUp,
    pause,
    watchCatchUp,
    readSyncedAt,
    waitForCatchUp,
    afterHandOver,
  };
}
