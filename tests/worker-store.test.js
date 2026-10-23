import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { UPDATING_WAIT_MS } from "../shared/page/catch-up-note.js";
import { createWorkerStore } from "../shared/page/worker-store.js";

// Stand-ins for the browser: each read waits until the test answers it, and the socket opens
// when the test says so.
/** @param {{ isShowing?: () => boolean }} [options] */
function startStore({ isShowing } = {}) {
  const reads = [];
  const sockets = [];
  globalThis.fetch = /** @type {any} */ (
    (url) =>
      new Promise((resolve) => {
        const answer = (body) => resolve(new Response(JSON.stringify(body)));
        reads.push({ url: String(url), answer, resolve });
      })
  );
  globalThis.WebSocket = /** @type {any} */ (
    class {
      constructor() {
        this.listeners = {};
        this.isClosed = false;
        this.messages = [];
        sockets.push(this);
      }
      send(message) {
        this.messages.push(JSON.parse(message));
      }
      addEventListener(type, listener) {
        this.listeners[type] = listener;
      }
      close() {
        this.isClosed = true;
        this.listeners.close?.();
      }
    }
  );
  const store = createWorkerStore({ baseUrl: new URL("https://mlb-app.example/k3y/"), isShowing });
  const openSocket = () => sockets.at(-1).listeners.open();
  const hearData = (data) => sockets.at(-1).listeners.message({ data });
  /** @param {unknown} message what the Worker sends down the open socket */
  const hear = (message) => hearData(JSON.stringify(message));
  return { store, reads, sockets, openSocket, hear, hearData };
}

const START = Date.parse("2026-10-04T21:00:00Z");

beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"], now: START }));
afterEach(() => mock.timers.reset());

const settle = () => new Promise((resolve) => setImmediate(resolve));
const HANDSHAKE_WAIT_MS = 3 * 1000;
const RECONNECT_MAX_MS = 30 * 1000;
const SEASON_URL = "https://mlb-app.example/k3y/store/seasons/2026";
const READINGS_URL = "https://mlb-app.example/k3y/store/readings-2026?limit=10";

test("watches started before the socket opens read once each, as it opens", () => {
  const { store, reads, openSocket } = startStore();
  store.doc("seasons/2026").onSnapshot(() => {});
  store
    .collection("readings-2026")
    .limit(10)
    .onSnapshot(() => {});
  assert.equal(reads.length, 0);

  openSocket();

  assert.deepEqual(
    reads.map((read) => read.url),
    [SEASON_URL, READINGS_URL],
  );
});

test("watches whose socket never opens read once each after the handshake wait", () => {
  const { store, reads } = startStore();
  store.doc("seasons/2026").onSnapshot(() => {});
  store
    .collection("readings-2026")
    .limit(10)
    .onSnapshot(() => {});

  mock.timers.tick(HANDSHAKE_WAIT_MS - 1);
  assert.equal(reads.length, 0);
  mock.timers.tick(1);
  assert.deepEqual(
    reads.map((read) => read.url),
    [SEASON_URL, READINGS_URL],
  );

  mock.timers.tick(HANDSHAKE_WAIT_MS);
  assert.equal(reads.length, 2);
});

test("a watch started after the handshake wait ran out reads right away", () => {
  const { store, reads } = startStore();
  store.doc("seasons/2026").onSnapshot(() => {});
  mock.timers.tick(HANDSHAKE_WAIT_MS);

  store
    .collection("readings-2026")
    .limit(10)
    .onSnapshot(() => {});

  assert.deepEqual(
    reads.map((read) => read.url),
    [SEASON_URL, READINGS_URL],
  );
});

test("a socket that opens in time leaves the handshake wait with nothing to read", () => {
  const { store, reads, openSocket } = startStore();
  store.doc("seasons/2026").onSnapshot(() => {});
  openSocket();

  mock.timers.tick(HANDSHAKE_WAIT_MS);

  assert.deepEqual(
    reads.map((read) => read.url),
    [SEASON_URL],
  );
});

test("a watch started once the socket is open reads right away", () => {
  const { store, reads, openSocket } = startStore();
  store.doc("seasons/2026").onSnapshot(() => {});
  openSocket();

  store
    .collection("readings-2026")
    .limit(10)
    .onSnapshot(() => {});

  assert.deepEqual(
    reads.map((read) => read.url),
    [SEASON_URL, READINGS_URL],
  );
});

/** @param {any} value */
const assertFrozenDeeply = (value) => {
  assert.ok(Object.isFrozen(value));
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") assertFrozenDeeply(nested);
  }
};

const SEASON = { year: 2026, teams: { NYM: { record: [90, 72] } }, log: [{ id: "1", runs: [3] }] };

test("a document the store returns is frozen, down to its nested objects and arrays", async () => {
  const { store, reads } = startStore();
  const reading = store.doc("seasons/2026").get();
  reads[0].answer({ data: structuredClone(SEASON) });
  const data = (await reading).data();

  assert.deepEqual(data, SEASON);
  assertFrozenDeeply(data);
  assert.throws(() => {
    data.log[0].runs.push(4);
  }, TypeError);
});

test("each document in a listing the store returns is frozen deeply", async () => {
  const { store, reads } = startStore();
  const reading = store.collection("seasons").limit(10).get();
  reads[0].answer({ docs: [{ id: "2026", data: structuredClone(SEASON) }] });
  const [doc] = (await reading).docs;

  assert.deepEqual(doc.data(), SEASON);
  assertFrozenDeeply(doc.data());
});

test("a document read that arrives after a newer one is dropped", async () => {
  const { store, reads, openSocket } = startStore();
  const seen = [];
  store.doc("seasons/2026").onSnapshot((snapshot) => seen.push(snapshot.data().ranking));
  openSocket();
  store.catchUp();
  openSocket();
  assert.equal(reads.length, 2);
  reads[1].answer({ data: { ranking: ["TOR"] } });
  await settle();
  reads[0].answer({ data: { ranking: ["NYY"] } });
  await settle();
  assert.deepEqual(seen, [["TOR"]]);
});

test("a listing that arrives after a newer one is dropped", async () => {
  const { store, reads, openSocket } = startStore();
  const seen = [];
  store
    .collection("readings-2026")
    .limit(10)
    .onSnapshot(({ docs }) => seen.push(docs.map((doc) => doc.id)));
  openSocket();
  store.catchUp();
  openSocket();
  assert.equal(reads.length, 2);
  reads[1].answer({ docs: [{ id: "2026-09-25-01", data: {} }] });
  await settle();
  reads[0].answer({ docs: [{ id: "2026-09-24-01", data: {} }] });
  await settle();
  assert.deepEqual(seen, [["2026-09-25-01"]]);
});

test("a document the Worker removes leaves a watched collection, and its listeners hear it", async () => {
  const { store, reads, sockets, openSocket } = startStore();
  const seen = [];
  store
    .collection("schedules-2026")
    .limit(12)
    .onSnapshot(({ docs }) => seen.push(docs.map((doc) => doc.id)));
  openSocket();
  reads[0].answer({
    docs: [
      { id: "2026-10", data: { games: [] } },
      { id: "2026-11", data: { games: [] } },
    ],
  });
  await settle();

  sockets
    .at(-1)
    .listeners.message({ data: JSON.stringify({ path: "schedules-2026/2026-11", data: null }) });
  assert.deepEqual(seen, [["2026-10", "2026-11"], ["2026-10"]]);
});

async function startWatchingSeason() {
  const started = startStore();
  const documents = [];
  const collections = [];
  started.store.doc("seasons/2026").onSnapshot((snapshot) => documents.push(snapshot.data()));
  started.store
    .collection("seasons")
    .limit(10)
    .onSnapshot(({ docs }) => collections.push(docs.map((doc) => doc.data())));
  started.openSocket();
  started.reads[0].answer({ data: { inning: 3 } });
  started.reads[1].answer({ docs: [{ id: "2026", data: { inning: 3 } }] });
  await settle();
  return { ...started, documents, collections };
}

test("an unknown socket message leaves watched documents and collections unchanged, and the following push arrives", async () => {
  const { hear, documents, collections } = await startWatchingSeason();

  assert.doesNotThrow(() => hear({ connected: true }));
  assert.deepEqual(documents, [{ inning: 3 }]);
  assert.deepEqual(collections, [[{ inning: 3 }]]);

  hear({ path: "seasons/2026", data: { inning: 4 } });
  assert.deepEqual(documents, [{ inning: 3 }, { inning: 4 }]);
  assert.deepEqual(collections, [[{ inning: 3 }], [{ inning: 4 }]]);
});

test("malformed socket messages leave watches unchanged and allow the next push on the same socket", async () => {
  const { hearData, documents, collections, sockets } = await startWatchingSeason();
  const malformed = [
    "{",
    "",
    ...[
      null,
      false,
      1,
      "seasons/2026",
      [],
      {},
      { data: { inning: 99 } },
      { path: null, data: { inning: 99 } },
      { path: 2026, data: { inning: 99 } },
      { path: [], data: { inning: 99 } },
      { path: "", data: { inning: 99 } },
      { path: "seasons", data: { inning: 99 } },
      { path: "seasons/", data: { inning: 99 } },
      { path: "/2026", data: { inning: 99 } },
      { path: "seasons/2026/extra", data: { inning: 99 } },
      { path: "seasons/not valid", data: { inning: 99 } },
      { path: `seasons/${"a".repeat(65)}`, data: { inning: 99 } },
      { path: "seasons/2026" },
      { updating: false, path: "seasons/2026", data: { inning: 99 } },
    ].map((message) => JSON.stringify(message)),
    new ArrayBuffer(0),
    new Blob(["{}"]),
  ];

  for (const [index, data] of malformed.entries()) {
    const previousDocuments = [...documents];
    const previousCollections = [...collections];
    assert.doesNotThrow(() => hearData(data), `malformed message ${index}`);
    assert.deepEqual(documents, previousDocuments);
    assert.deepEqual(collections, previousCollections);

    const next = { inning: index + 4 };
    hearData(JSON.stringify({ path: "seasons/2026", data: next }));
    assert.deepEqual(documents, [...previousDocuments, next]);
    assert.deepEqual(collections, [...previousCollections, [next]]);
  }
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].isClosed, false);
});

test("a push without data cannot discard an outstanding document or collection read", async () => {
  const { store, reads, openSocket, hear } = startStore();
  const documents = [];
  const collections = [];
  store.doc("seasons/2026").onSnapshot((snapshot) => documents.push(snapshot.data()));
  store
    .collection("seasons")
    .limit(10)
    .onSnapshot(({ docs }) => collections.push(docs.map((doc) => doc.data())));
  openSocket();

  assert.doesNotThrow(() => hear({ path: "seasons/2026" }));
  reads[0].answer({ data: { inning: 3 } });
  reads[1].answer({ docs: [{ id: "2026", data: { inning: 3 } }] });
  await settle();
  assert.deepEqual(documents, [{ inning: 3 }]);
  assert.deepEqual(collections, [[{ inning: 3 }]]);

  hear({ path: "seasons/2026", data: { inning: 4 } });
  assert.deepEqual(documents, [{ inning: 3 }, { inning: 4 }]);
  assert.deepEqual(collections, [[{ inning: 3 }], [{ inning: 4 }]]);
});

test("catching up reads every watched document once, as the new socket opens", () => {
  const { store, reads, openSocket } = startStore();
  store.doc("seasons/2026").onSnapshot(() => {});
  openSocket();
  const readCount = reads.length;

  store.catchUp();
  assert.equal(reads.length, readCount);
  openSocket();

  assert.equal(reads.length, readCount + 1);
  assert.equal(reads.at(-1).url, SEASON_URL);
});

test("catching up swaps a socket that may have gone quiet for a new one", () => {
  const { store, sockets, openSocket } = startStore();
  store.doc("seasons/2026").onSnapshot(() => {});
  openSocket();

  store.catchUp();

  assert.equal(sockets.length, 2);
  assert.ok(sockets[0].isClosed);
  assert.ok(!sockets[1].isClosed);
});

test("a paused store closes its socket, and opens another only once it catches up", () => {
  const { store, reads, sockets, openSocket } = startStore();
  store.doc("seasons/2026").onSnapshot(() => {});
  openSocket();
  const readCount = reads.length;

  store.pause();
  mock.timers.tick(60 * 1000);

  assert.equal(sockets.length, 1);
  assert.ok(sockets[0].isClosed);
  assert.equal(reads.length, readCount);

  store.catchUp();
  openSocket();

  assert.equal(sockets.length, 2);
  assert.equal(reads.length, readCount + 1);
});

test("a store tells the Worker what it watches as its socket opens, and as that changes", () => {
  const { store, sockets, openSocket } = startStore();
  const unwatchSeason = store.doc("seasons/2026").onSnapshot(() => {});
  store
    .collection("readings-2026")
    .limit(10)
    .onSnapshot(() => {});
  openSocket();
  store.doc("seasons/2026").onSnapshot(() => {});
  const unwatchGame = store.doc("games/1").onSnapshot(() => {});
  unwatchGame();

  assert.deepEqual(sockets[0].messages, [
    { watching: ["seasons/2026", "readings-2026/"] },
    { watching: ["seasons/2026", "games/1", "readings-2026/"] },
    { watching: ["seasons/2026", "readings-2026/"] },
  ]);
  unwatchSeason();
  assert.equal(sockets[0].messages.length, 3);
});

test("a read the Worker turns away for want of the access code reloads the page", async () => {
  const { store, reads, openSocket } = startStore();
  let reloads = 0;
  globalThis.location = /** @type {any} */ ({ reload: () => (reloads += 1) });
  store.doc("seasons/2026").onSnapshot(
    () => {},
    () => {},
  );
  openSocket();
  reads[0].resolve(
    new Response(JSON.stringify({ error: { code: "access_required" } }), { status: 401 }),
  );
  await settle();
  assert.equal(reloads, 1);
  delete globalThis.location;
});

const RECONNECT_FIRST_MS = 1000;
const failRead = (read) => read.resolve(new Response("", { status: 503 }));

test("a socket that hangs, and whose reads fail, gives way to a new one that reads again", async () => {
  const { store, reads, sockets } = startStore();
  store.doc("seasons/2026").onSnapshot(
    () => {},
    () => {},
  );
  mock.timers.tick(HANDSHAKE_WAIT_MS);
  failRead(reads[0]);
  await settle();

  assert.ok(sockets[0].isClosed);
  mock.timers.tick(RECONNECT_FIRST_MS);
  assert.equal(sockets.length, 2);
  assert.deepEqual(
    reads.map((read) => read.url),
    [SEASON_URL, SEASON_URL],
  );
});

test("reads that fail once the socket opens start over with a new socket, waiting longer each time", async () => {
  const { store, reads, sockets, openSocket } = startStore();
  store.doc("seasons/2026").onSnapshot(
    () => {},
    () => {},
  );
  openSocket();
  failRead(reads[0]);
  await settle();
  mock.timers.tick(RECONNECT_FIRST_MS);
  assert.equal(sockets.length, 2);
  openSocket();
  failRead(reads.at(-1));
  await settle();

  mock.timers.tick(RECONNECT_FIRST_MS);
  assert.equal(sockets.length, 2);
  mock.timers.tick(RECONNECT_FIRST_MS);
  assert.equal(sockets.length, 3);
});

test("a store is caught up once its socket is open and every watched document has been read", async () => {
  const { store, reads, openSocket } = startStore();
  const changes = [];
  store.watchCatchUp((isCaughtUp) => changes.push(isCaughtUp));
  store.doc("seasons/2026").onSnapshot(() => {});
  store
    .collection("readings-2026")
    .limit(10)
    .onSnapshot(() => {});
  openSocket();
  reads[0].answer({ data: {} });
  await settle();
  assert.deepEqual(changes, [false]);

  reads[1].answer({ docs: [] });
  await settle();

  assert.deepEqual(changes, [false, true]);
});

test("reads that answer before the socket opens leave the store behind until it opens", async () => {
  const { store, reads, openSocket } = startStore();
  const changes = [];
  store.watchCatchUp((isCaughtUp) => changes.push(isCaughtUp));
  store.doc("seasons/2026").onSnapshot(() => {});
  mock.timers.tick(HANDSHAKE_WAIT_MS);
  reads[0].answer({ data: {} });
  await settle();
  assert.deepEqual(changes, [false]);

  openSocket();
  reads[1].answer({ data: {} });
  await settle();

  assert.deepEqual(changes, [false, true]);
});

test("a socket that closes leaves the store behind, and coming back puts it behind anew", async () => {
  const { store, reads, sockets, openSocket } = startStore();
  const changes = [];
  store.doc("seasons/2026").onSnapshot(() => {});
  openSocket();
  reads[0].answer({ data: {} });
  await settle();
  store.watchCatchUp((isCaughtUp) => changes.push(isCaughtUp));

  sockets[0].close();
  store.catchUp();

  assert.deepEqual(changes, [true, false, false]);
});

/**
 * Opens the socket and answers its read, so the store has caught up.
 * @param {ReturnType<typeof startStore>} started
 */
async function catchUpStore({ reads, openSocket }) {
  openSocket();
  reads.at(-1).answer({ data: {} });
  await settle();
}

test("a store has no time it was current until it first catches up", async () => {
  const started = startStore();
  started.store.doc("seasons/2026").onSnapshot(() => {});
  assert.equal(started.store.readSyncedAt(), null);

  await catchUpStore(started);

  assert.equal(started.store.readSyncedAt(), START);
});

test("a store that falls behind was current until then", async () => {
  const started = startStore();
  started.store.doc("seasons/2026").onSnapshot(() => {});
  await catchUpStore(started);

  mock.timers.tick(5000);
  started.sockets[0].close();

  assert.equal(started.store.readSyncedAt(), START + 5000);
});

test("a page that comes back still caught up was current when it went away", async () => {
  const started = startStore();
  started.store.doc("seasons/2026").onSnapshot(() => {});
  await catchUpStore(started);

  mock.timers.tick(60 * 1000);
  started.store.catchUp(45 * 1000);

  assert.equal(started.store.readSyncedAt(), START + 15 * 1000);
});

test("a page that comes back after its store paused was current until the pause", async () => {
  const started = startStore();
  started.store.doc("seasons/2026").onSnapshot(() => {});
  await catchUpStore(started);
  mock.timers.tick(60 * 1000);
  started.store.pause();

  mock.timers.tick(10 * 60 * 1000);
  started.store.catchUp(11 * 60 * 1000);

  assert.equal(started.store.readSyncedAt(), START + 60 * 1000);
});

test("waiting for the store to catch up ends as it does", async () => {
  const started = startStore();
  started.store.doc("seasons/2026").onSnapshot(() => {});
  const waiting = started.store.waitForCatchUp();

  await catchUpStore(started);

  assert.equal(await waiting, true);
});

test("a socket whose handshake hangs is given up for a new one once the reads made without it answer, waiting longer each time", async () => {
  const { store, reads, sockets } = startStore();
  store.doc("seasons/2026").onSnapshot(() => {});
  mock.timers.tick(HANDSHAKE_WAIT_MS);
  reads[0].answer({ data: {} });
  await settle();
  assert.equal(sockets.length, 1);

  mock.timers.tick(RECONNECT_FIRST_MS);
  assert.equal(sockets.length, 2);
  assert.equal(sockets[0].isClosed, true);
  mock.timers.tick(HANDSHAKE_WAIT_MS);
  reads[1].answer({ data: {} });
  await settle();
  mock.timers.tick(RECONNECT_FIRST_MS);
  assert.equal(sockets.length, 2);
  mock.timers.tick(RECONNECT_FIRST_MS);
  assert.equal(sockets.length, 3);
});

/**
 * Starts a store whose socket's handshake outlasted the wait, and whose reads made without it
 * have answered.
 */
async function startHungStore() {
  const started = startStore();
  started.store.doc("seasons/2026").onSnapshot(() => {});
  mock.timers.tick(HANDSHAKE_WAIT_MS);
  started.reads[0].answer({ data: {} });
  await settle();
  return started;
}

test("a hung socket that opens before it's given up is kept", async () => {
  const { sockets, openSocket } = await startHungStore();

  openSocket();
  mock.timers.tick(RECONNECT_MAX_MS);

  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].isClosed, false);
});

test("a hung socket that closes without ever opening reconnects", async () => {
  const { sockets } = await startHungStore();

  sockets[0].close();
  mock.timers.tick(RECONNECT_MAX_MS);

  assert.equal(sockets.length, 2);
});

test("a hung socket that opens and then closes reconnects", async () => {
  const { sockets, openSocket } = await startHungStore();

  openSocket();
  sockets[0].close();
  mock.timers.tick(RECONNECT_MAX_MS);

  assert.equal(sockets.length, 2);
});

test("on a network that refuses sockets, the page was current as each read of everything it watches began", async () => {
  const started = startStore();
  const { store, reads, sockets } = started;
  /** @type {(number | null)[]} */
  const moves = [];
  store.watchSyncedAt(() => moves.push(store.readSyncedAt()));
  store.doc("seasons/2026").onSnapshot(() => {});
  sockets[0].close();

  mock.timers.tick(RECONNECT_FIRST_MS);
  sockets[1].close();
  mock.timers.tick(500);
  reads[0].answer({ data: {} });
  await settle();

  assert.equal(store.readSyncedAt(), START + RECONNECT_FIRST_MS);
  assert.deepEqual(moves, [START + RECONNECT_FIRST_MS]);
});

test("a read that answers after the page caught up and fell behind again never moves when it was current back", async () => {
  const { store, reads, sockets, openSocket } = startStore();
  /** @type {(number | null)[]} */
  const moves = [];
  store.watchSyncedAt(() => moves.push(store.readSyncedAt()));
  store.doc("seasons/2026").onSnapshot(() => {});
  sockets[0].close();
  mock.timers.tick(RECONNECT_FIRST_MS);
  const slowRead = reads[0];

  openSocket();
  reads[1].answer({ data: {} });
  await settle();
  mock.timers.tick(5000);
  sockets[1].close();
  slowRead.answer({ data: {} });
  await settle();

  assert.equal(store.readSyncedAt(), START + RECONNECT_FIRST_MS + 5000);
  assert.deepEqual(moves, []);
});

test("waiting for a store that doesn't catch up gives up after ten seconds", async () => {
  const { store } = startStore();
  store.doc("seasons/2026").onSnapshot(() => {});
  const waiting = store.waitForCatchUp();

  mock.timers.tick(10 * 1000);

  assert.equal(await waiting, false);
});

/**
 * A store showing a drawing, caught up on the season, that comes back after time away to a store
 * that says its update is coming: the season it last had, the season the store held, and each
 * season and catch-up the page heard of since.
 */
async function startComingBack() {
  const started = startStore({ isShowing: () => true });
  const seen = [];
  const changes = [];
  started.store.doc("seasons/2026").onSnapshot((snapshot) => seen.push(snapshot.data().inning));
  started.openSocket();
  started.hear({ updating: false });
  started.reads.at(-1).answer({ data: { inning: 3 } });
  await settle();
  started.store.watchCatchUp((isCaughtUp) => changes.push(isCaughtUp));

  started.store.catchUp(3 * 60 * 1000);
  started.openSocket();
  started.hear({ updating: true });
  started.reads.at(-1).answer({ data: { inning: 8 } });
  await settle();
  return { ...started, seen, changes };
}

test("malformed update messages cannot release held documents or finish catching up", async () => {
  const { hear, seen, changes } = await startComingBack();
  for (const updating of [null, 0, "", "false", [], {}]) {
    assert.doesNotThrow(() => hear({ updating }));
    assert.deepEqual(seen, [3]);
    assert.deepEqual(changes, [true, false]);
  }
  hear({ updating: false, path: "seasons/2026", data: { inning: 99 } });
  assert.deepEqual(seen, [3]);
  assert.deepEqual(changes, [true, false]);

  hear({ path: "seasons/2026", data: { inning: 9 } });
  hear({ updating: false });
  assert.deepEqual(seen, [3, 9]);
  assert.deepEqual(changes, [true, false, true]);
});

test("a page coming back with a drawing holds what the store held until the store's update is done, then catches up with the latest at once", async () => {
  const { seen, changes, hear } = await startComingBack();
  assert.deepEqual(seen, [3]);
  assert.deepEqual(changes, [true, false]);

  hear({ path: "seasons/2026", data: { inning: 9 } });
  assert.deepEqual(seen, [3]);

  hear({ updating: false });
  assert.deepEqual(seen, [3, 9]);
  assert.deepEqual(changes, [true, false, true]);
});

test("a page coming back that reads before it redraws, as one whose load failed does, says it has caught up only once it has drawn", async () => {
  const { store, changes, hear } = await startComingBack();
  const steps = [];
  /** @type {() => void} */
  let finishRead = () => {};
  store.afterHandOver(async () => {
    await new Promise((resolve) => (finishRead = () => resolve(undefined)));
    steps.push("drawn");
  });
  store.watchCatchUp((isCaughtUp) => isCaughtUp && steps.push("caught up"));

  hear({ updating: false });
  await settle();
  assert.deepEqual(changes, [true, false]);

  finishRead();
  await settle();
  assert.deepEqual(steps, ["drawn", "caught up"]);
  assert.deepEqual(changes, [true, false, true]);
});

test("a page coming back to an update that changed nothing catches up with what the store held as the update is done", async () => {
  const { seen, changes, hear } = await startComingBack();

  hear({ updating: false });

  assert.deepEqual(seen, [3, 8]);
  assert.deepEqual(changes, [true, false, true]);
});

test("a page coming back waits no longer for the store's update than it takes to say it's getting the latest scores", async () => {
  const { seen, changes, hear } = await startComingBack();

  mock.timers.tick(UPDATING_WAIT_MS - 1);
  assert.deepEqual(seen, [3]);
  mock.timers.tick(1);
  assert.deepEqual(seen, [3, 8]);
  assert.deepEqual(changes, [true, false, true]);

  hear({ path: "seasons/2026", data: { inning: 9 } });
  assert.deepEqual(seen, [3, 8, 9]);
});

test("a page that opens with nothing drawn takes what it watches at once, even once it has drawn from a read of its own", async () => {
  let isDrawn = false;
  const { store, reads, openSocket, hear } = startStore({ isShowing: () => isDrawn });
  const news = [];
  store.doc("news/cards").onSnapshot((snapshot) => news.push(snapshot.data().count));
  openSocket();
  hear({ updating: true });
  isDrawn = true;

  reads[0].answer({ data: { count: 5 } });
  await settle();

  assert.deepEqual(news, [5]);
});

test("a page with nothing drawn yet takes what the store holds at once, and catches up without waiting for the store's update", async () => {
  const { store, reads, openSocket, hear } = startStore({ isShowing: () => false });
  const seen = [];
  const changes = [];
  store.doc("seasons/2026").onSnapshot((snapshot) => seen.push(snapshot.data().inning));
  store.watchCatchUp((isCaughtUp) => changes.push(isCaughtUp));
  openSocket();
  hear({ updating: true });

  reads[0].answer({ data: { inning: 8 } });
  await settle();

  assert.deepEqual(seen, [8]);
  assert.deepEqual(changes, [false, true]);
});

test("a page that loads with the copy it last showed waits for the store's update before it takes what the store holds, and draws it before it says it has caught up", async () => {
  const { store, reads, openSocket, hear } = startStore({ isShowing: () => true });
  const steps = [];
  store.doc("seasons/2026").onSnapshot((snapshot) => steps.push(snapshot.data().inning));
  store.afterHandOver(() => steps.push("drawn"));
  store.watchCatchUp((isCaughtUp) => steps.push(isCaughtUp));
  openSocket();
  hear({ updating: true });
  reads[0].answer({ data: { inning: 8 } });
  await settle();
  assert.deepEqual(steps, [false]);

  hear({ updating: false });

  assert.deepEqual(steps, [false, 8, "drawn", true]);
});
