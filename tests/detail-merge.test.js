import test from "node:test";
import assert from "node:assert/strict";
import { mergeReadDetails } from "../shared/worker/detail-merge.js";

test("a read that changed nothing saves nothing", () => {
  assert.equal(mergeReadDetails({ lead: 1 }, { lead: 1 }, { lead: 2 }), null);
});

test("a read of a game never saved saves all of it", () => {
  assert.deepEqual(mergeReadDetails(null, { lead: 1 }, null), { lead: 1 });
});

test("a field the read sets to null that was never saved is saved", () => {
  assert.deepEqual(mergeReadDetails(null, { lead: 1, missing: null }, null), {
    lead: 1,
    missing: null,
  });
});

test("a read's changed fields land on the latest, and its unchanged fields keep the latest's", () => {
  assert.deepEqual(
    mergeReadDetails(
      { boxScore: "live", lead: "old" },
      { boxScore: "final", lead: "old" },
      { boxScore: "live", lead: "new", extra: 1 },
    ),
    { boxScore: "final", lead: "new", extra: 1 },
  );
});
