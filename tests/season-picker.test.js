import test from "node:test";
import assert from "node:assert/strict";
import {
  keepSeasonYears,
  listSeasonOptions,
  listSeasonYears,
} from "../shared/page/season-picker.js";

test("the seasons the store keeps list newest first, leaving out anything that isn't a year", () => {
  const docs = [{ id: "2025" }, { id: "2027" }, { id: "notes" }, { id: "2026" }];

  assert.deepEqual(listSeasonYears(docs), ["2027", "2026", "2025"]);
});

test("the picker names each season, newest first, with the shown one among them and chosen", () => {
  assert.deepEqual(
    listSeasonOptions(
      ["2024", "2025"],
      { shownYear: 2026, currentYear: null },
      { seasonSpansYears: true },
    ),
    [
      { year: "2026", name: "2026-27", isShown: true },
      { year: "2025", name: "2025-26", isShown: false },
      { year: "2024", name: "2024-25", isShown: false },
    ],
  );
  assert.deepEqual(
    listSeasonOptions(
      ["2026", "2025"],
      { shownYear: 2025, currentYear: null },
      { seasonSpansYears: false },
    ),
    [
      { year: "2026", name: "2026", isShown: false },
      { year: "2025", name: "2025", isShown: true },
    ],
  );
});

test("the seasons the store keeps stand as it last said while a read fails, and none before it has said", async () => {
  const answers = [
    () => Promise.reject(new Error("offline")),
    () => Promise.resolve(["2026", "2025", "2024"]),
    () => Promise.reject(new Error("offline")),
    () => Promise.resolve(["2026", "2025"]),
  ];
  const readSeasonYears = keepSeasonYears(() =>
    /** @type {() => Promise<string[]>} */ (answers.shift())(),
  );

  assert.equal(await readSeasonYears(), null);
  assert.deepEqual(await readSeasonYears(), ["2026", "2025", "2024"]);
  assert.deepEqual(await readSeasonYears(), ["2026", "2025", "2024"]);
  assert.deepEqual(await readSeasonYears(), ["2026", "2025"]);
});

test("the picker lists the current season even where the seasons it knows end before it", () => {
  assert.deepEqual(
    listSeasonOptions(
      ["2025"],
      { shownYear: 2025, currentYear: 2026 },
      { seasonSpansYears: false },
    ),
    [
      { year: "2026", name: "2026", isShown: false },
      { year: "2025", name: "2025", isShown: true },
    ],
  );
});
