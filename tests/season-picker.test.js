import test from "node:test";
import assert from "node:assert/strict";
import { listSeasonOptions, listSeasonYears } from "../shared/page/season-picker.js";

test("the seasons the store keeps list newest first, leaving out anything that isn't a year", () => {
  const docs = [{ id: "2025" }, { id: "2027" }, { id: "notes" }, { id: "2026" }];

  assert.deepEqual(listSeasonYears(docs), ["2027", "2026", "2025"]);
});

test("the picker names each season, newest first, with the shown one among them and chosen", () => {
  assert.deepEqual(listSeasonOptions(["2024", "2025"], 2026, { seasonSpansYears: true }), [
    { year: "2026", name: "2026-27", isShown: true },
    { year: "2025", name: "2025-26", isShown: false },
    { year: "2024", name: "2024-25", isShown: false },
  ]);
  assert.deepEqual(listSeasonOptions(["2026", "2025"], 2025, { seasonSpansYears: false }), [
    { year: "2026", name: "2026", isShown: false },
    { year: "2025", name: "2025", isShown: true },
  ]);
});
