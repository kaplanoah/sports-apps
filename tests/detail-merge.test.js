import test from "node:test";
import assert from "node:assert/strict";
import { mergeReadDetails } from "../shared/worker/detail-merge.js";

const FIELDS = ["boxScore", "lead"];

test("a read that changed nothing saves nothing", () => {
  assert.equal(mergeReadDetails({ lead: 1 }, { lead: 1 }, { lead: 2 }, FIELDS), null);
  assert.equal(mergeReadDetails({ lead: 1 }, { lead: 1 }, { lead: 2 }), null);
});

test("a read of a game never saved saves all of it, a null part too", () => {
  assert.deepEqual(mergeReadDetails(null, { boxScore: 1, lead: null }, null, FIELDS), {
    boxScore: 1,
    lead: null,
  });
  assert.deepEqual(mergeReadDetails(null, { boxScore: 1 }, null), { boxScore: 1 });
});

test("a part the read changed lands on the latest, which keeps its other parts", () => {
  assert.deepEqual(
    mergeReadDetails(
      { boxScore: "live", lead: "old" },
      { boxScore: "final", lead: "old" },
      { boxScore: "live", lead: "new", extra: 1 },
      FIELDS,
    ),
    { boxScore: "final", lead: "new", extra: 1 },
  );
});

test("a part the read and another writer both changed keeps the latest's", () => {
  assert.equal(
    mergeReadDetails({ boxScore: "live" }, { boxScore: "live 2" }, { boxScore: "final" }, FIELDS),
    null,
  );
});

test("a part the read dropped goes, unless another writer changed it", () => {
  assert.deepEqual(mergeReadDetails({ lead: 1 }, {}, { lead: 1, boxScore: 2 }, FIELDS), {
    boxScore: 2,
  });
  assert.equal(mergeReadDetails({ lead: 1 }, {}, { lead: 9 }, FIELDS), null);
});

test("without parts, a read lands whole or not at all", () => {
  assert.deepEqual(
    mergeReadDetails(
      { state: "live", runs: 1 },
      { state: "final", runs: 4 },
      { state: "live", runs: 1 },
    ),
    { state: "final", runs: 4 },
  );
  assert.equal(
    mergeReadDetails(
      { state: "live", runs: 1 },
      { state: "live", runs: 2 },
      { state: "final", runs: 4 },
    ),
    null,
  );
});
