import test from "node:test";
import assert from "node:assert/strict";
import { createDocs } from "./job-context.js";

/**
 * The persistence behavior shared by league updaters, using each app's recorded snapshot and
 * its own representations of unavailable and changed standings.
 * @template {{ season: number, asOf: string, standings: unknown }} Snapshot
 * @param {object} league
 * @param {Snapshot} league.snapshot
 * @param {(docs: import("../shared/worker/season-store.js").SeasonDocuments, snapshot: Snapshot) => Promise<void>} league.saveSnapshot
 * @param {(snapshot: Snapshot) => Snapshot} league.omitStandings
 * @param {(snapshot: Snapshot) => Snapshot} league.advanceStandings
 * @param {(season: number) => string} league.nameSeasonKey
 */
export function testSeasonUpdater({
  snapshot,
  saveSnapshot,
  omitStandings,
  advanceStandings,
  nameSeasonKey,
}) {
  const key = nameSeasonKey(snapshot.season);
  const later = {
    ...snapshot,
    asOf: new Date(Date.parse(snapshot.asOf) + 60_000).toISOString(),
  };

  test("repeated snapshots and a later timestamp alone write and remove no documents", async () => {
    const docs = createDocs();
    await saveSnapshot(docs, structuredClone(snapshot));
    assert.ok((await docs.read(key))?.standings);
    const saved = structuredClone(docs.stored);
    docs.writes.length = 0;
    docs.removals.length = 0;

    await saveSnapshot(docs, structuredClone(snapshot));
    await saveSnapshot(docs, structuredClone(later));

    assert.deepEqual(docs.stored, saved);
    assert.deepEqual(docs.writes, []);
    assert.deepEqual(docs.removals, []);
  });

  test("unavailable standings preserve the saved standings through repeated failed reads", async () => {
    const docs = createDocs();
    await saveSnapshot(docs, structuredClone(snapshot));
    const saved = (await docs.read(key)).standings;
    assert.ok(saved);
    const unavailable = omitStandings(structuredClone(later));

    await saveSnapshot(docs, structuredClone(unavailable));
    await saveSnapshot(docs, structuredClone(unavailable));

    assert.deepEqual((await docs.read(key)).standings, saved);
  });

  test("standings recover after unavailable reads and the recovered snapshot becomes idempotent", async () => {
    const docs = createDocs();
    await saveSnapshot(docs, structuredClone(snapshot));
    const unavailable = omitStandings(structuredClone(later));
    await saveSnapshot(docs, unavailable);
    const recovered = advanceStandings(structuredClone(later));
    assert.notDeepEqual(recovered.standings, snapshot.standings);

    await saveSnapshot(docs, structuredClone(recovered));
    assert.deepEqual((await docs.read(key)).standings, recovered.standings);
    const saved = structuredClone(docs.stored);
    docs.writes.length = 0;
    docs.removals.length = 0;
    await saveSnapshot(docs, structuredClone(recovered));

    assert.deepEqual(docs.stored, saved);
    assert.deepEqual(docs.writes, []);
    assert.deepEqual(docs.removals, []);
  });
}
