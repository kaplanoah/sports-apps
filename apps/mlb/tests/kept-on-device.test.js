import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { keepRanking, keepSeenAt, readRanking, readSeenAt } from "../page/js/kept-on-device.js";
import { dropSavedStorage, useSavedStorage } from "./saved-storage.js";

afterEach(dropSavedStorage);

test("a device keeps its own ranking for each season", () => {
  const saved = new Map();
  useSavedStorage(saved);

  keepRanking(2025, ["LAD", "TOR"]);
  keepRanking(2026, ["NYY"]);

  assert.deepEqual(readRanking(2025), ["LAD", "TOR"]);
  assert.deepEqual(readRanking(2026), ["NYY"]);
  assert.equal(saved.get("rankings"), '{"2025":["LAD","TOR"],"2026":["NYY"]}');
});

test("a season this device never ranked, or a ranking that can't be read, has no clubs", () => {
  useSavedStorage(new Map([["rankings", '{"2026":"NYY"}']]));

  assert.deepEqual(readRanking(2025), []);
  assert.deepEqual(readRanking(2026), []);
});

test("a device keeps when it last dismissed each season's updates", () => {
  const saved = new Map([["updatesSeenAt", '{"2025":1759300000000}']]);
  useSavedStorage(saved);

  keepSeenAt(2026, 1790000000000);

  assert.equal(readSeenAt(2025), 1759300000000);
  assert.equal(readSeenAt(2026), 1790000000000);
  assert.equal(readSeenAt(2024), 0);
});

test("a device that has dismissed no season's updates is new to the app", () => {
  useSavedStorage(new Map());

  assert.equal(readSeenAt(2026), null);
});
