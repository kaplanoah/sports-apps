import test from "node:test";
import assert from "node:assert/strict";
import { nameOvertime, namePeriod } from "../page/js/periods.js";

test("a quarter is named by its number, and each overtime after the fourth by its count", () => {
  assert.deepEqual([1, 4, 5, 6, 7].map(namePeriod), ["Q1", "Q4", "OT", "2OT", "3OT"]);
  assert.deepEqual([5, 6].map(nameOvertime), ["OT", "2OT"]);
});
