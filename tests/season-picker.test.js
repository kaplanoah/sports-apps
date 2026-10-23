import test from "node:test";
import assert from "node:assert/strict";
import {
  isSeasonPickerShown,
  keepSeasonYears,
  listSeasonOptions,
  listSeasonYears,
  watchSeasonPicks,
} from "../shared/page/season-picker.js";

test("beta shows a picker with one season", () => {
  assert.equal(isSeasonPickerShown(1, "beta"), true);
  assert.equal(isSeasonPickerShown(0, "beta"), false);
});

test("production hides a picker with only one season", () => {
  assert.equal(isSeasonPickerShown(1, null), false);
  assert.equal(isSeasonPickerShown(0, null), false);
});

test("production shows a picker with two seasons", () => {
  assert.equal(isSeasonPickerShown(2, null), true);
});

/**
 * A stand-in for the picker's row: its select's options, the one chosen and the one its markup
 * marks, and a way to choose one as a viewer does, resolving once the row has dealt with it.
 * @param {string[]} years
 * @param {string} marked
 */
function createRow(years, marked) {
  const options = years.map((value) => ({
    value,
    selected: value === marked,
    defaultSelected: value === marked,
  }));
  const picker = {
    options,
    get value() {
      return options.find((option) => option.selected)?.value ?? "";
    },
    /** @param {string} value */
    set value(value) {
      for (const option of options) option.selected = option.value === value;
    },
  };
  /** @type {(event: { target: typeof picker }) => Promise<void>} */
  let onChange = async () => {};
  const row = {
    querySelector: () => picker,
    addEventListener: (/** @type {string} */ _type, /** @type {typeof onChange} */ listener) => {
      onChange = listener;
    },
  };
  /** @param {string} year */
  const choose = (year) => {
    picker.value = year;
    return onChange({ target: picker });
  };
  const readMarked = () => options.find((option) => option.defaultSelected)?.value;
  return { row: /** @type {any} */ (row), picker, choose, readMarked };
}

/** A pick a test answers, with the outcome it chooses. */
function createHeldPick() {
  /** @type {((outcome: import("../shared/page/season-reader.js").PickOutcome) => void)[]} */
  const answers = [];
  /** @returns {Promise<import("../shared/page/season-reader.js").PickOutcome>} */
  const pick = () => new Promise((resolve) => answers.push(resolve));
  return { pick, answers };
}

test("the seasons the store keeps list newest first, leaving out anything that isn't a year", () => {
  const docs = [{ id: "2025" }, { id: "2027" }, { id: "notes" }, { id: "2026" }];

  assert.deepEqual(listSeasonYears(docs), ["2027", "2026", "2025"]);
});

test("the picker names each season, newest first, with the picked one among them and chosen", () => {
  assert.deepEqual(
    listSeasonOptions(
      ["2024", "2025"],
      { pickedYear: 2026, currentYear: null },
      { seasonSpansYears: true },
    ),
    [
      { year: "2026", name: "2026-27", isPicked: true },
      { year: "2025", name: "2025-26", isPicked: false },
      { year: "2024", name: "2024-25", isPicked: false },
    ],
  );
  assert.deepEqual(
    listSeasonOptions(
      ["2026", "2025"],
      { pickedYear: 2025, currentYear: null },
      { seasonSpansYears: false },
    ),
    [
      { year: "2026", name: "2026", isPicked: false },
      { year: "2025", name: "2025", isPicked: true },
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
      { pickedYear: 2025, currentYear: 2026 },
      { seasonSpansYears: false },
    ),
    [
      { year: "2026", name: "2026", isPicked: false },
      { year: "2025", name: "2025", isPicked: true },
    ],
  );
});

test("an older read of the seasons that answers after a newer one leaves the newer's answer", async () => {
  /** @type {((years: string[]) => void)[]} */
  const answers = [];
  const readSeasonYears = keepSeasonYears(() => new Promise((resolve) => answers.push(resolve)));
  const older = readSeasonYears();
  const newer = readSeasonYears();
  answers[1](["2027", "2026"]);
  assert.deepEqual(await newer, ["2027", "2026"]);
  answers[0](["2026"]);

  assert.deepEqual(await older, ["2027", "2026"]);
});

/** @param {ReturnType<typeof createRow>["row"]} row */
function watchRow(row) {
  const { pick, answers } = createHeldPick();
  const redraws = { picked: 0, unread: 0 };
  watchSeasonPicks(row, {
    pick,
    showPicked: () => redraws.picked++,
    showUnread: () => redraws.unread++,
  });
  return { answers, redraws };
}

test("a pick shown redraws the page, with the picker's markup marking it", async () => {
  const { row, picker, choose, readMarked } = createRow(["2026", "2025"], "2026");
  const { answers, redraws } = watchRow(row);

  const chosen = choose("2025");
  answers[0]({ kind: "shown" });
  await chosen;

  assert.deepEqual([picker.value, readMarked()], ["2025", "2025"]);
  assert.deepEqual(redraws, { picked: 1, unread: 0 });
});

test("a pick that can't be read puts the picker on the season it leaves picked, and says so", async () => {
  const { row, picker, choose, readMarked } = createRow(["2026", "2025", "2024"], "2024");
  const { answers, redraws } = watchRow(row);

  const chosen = choose("2025");
  answers[0]({ kind: "unread", year: 2026 });
  await chosen;

  assert.deepEqual([picker.value, readMarked()], ["2026", "2026"]);
  assert.deepEqual(redraws, { picked: 0, unread: 1 });
});

test("before any season has loaded, two picks that can't be read put the picker back on the season it marked before both", async () => {
  const { row, picker, choose, readMarked } = createRow(["2026", "2025", "2024"], "2026");
  const { answers } = watchRow(row);

  const older = choose("2025");
  const newer = choose("2024");
  answers[0]({ kind: "replaced" });
  await older;
  answers[1]({ kind: "unread", year: null });
  await newer;

  assert.deepEqual([picker.value, readMarked()], ["2026", "2026"]);
});
