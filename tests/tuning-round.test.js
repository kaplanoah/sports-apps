import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSlider,
  findOffsetNudge,
  nudgeNumber,
  readNumber,
  readRound,
  restoreSettings,
  writeCopyText,
  writeNumber,
} from "#shared/tuning-round.js";

const DOT_LIFT = {
  property: "--dot-lift",
  label: "Dot lift",
  min: -2,
  max: 2,
  step: 0.25,
  unit: "px",
};
const TAG_CASE = { property: "--tag-case", label: "Tag case", options: ["none", "uppercase"] };
const ROUND = { name: "Team line", values: [DOT_LIFT, TAG_CASE] };

test("a round reads as a slider for each range and option buttons for each list", () => {
  const round = readRound(JSON.stringify(ROUND));
  assert.deepEqual(round, ROUND);
  assert.deepEqual(round.values.map(isSlider), [true, false]);
});

test("a round that can't be tuned says what's wrong with it", () => {
  const problems = [
    [{ values: [DOT_LIFT] }, "The round has no name."],
    [{ name: "Team line", values: [] }, "The round lists no values to tune."],
    [
      { name: "Team line", values: [{ ...DOT_LIFT, property: "dot-lift" }] },
      "The round's dot-lift names no custom property, like --dot-lift.",
    ],
    [
      { name: "Team line", values: [{ ...DOT_LIFT, label: "" }] },
      "The round's --dot-lift has no label.",
    ],
    [
      { name: "Team line", values: [{ ...DOT_LIFT, step: "1" }] },
      "The round's --dot-lift needs a min, a max, and a step, each a number.",
    ],
    [
      { name: "Team line", values: [{ ...DOT_LIFT, min: 2 }] },
      "The round's --dot-lift has a min that isn't below its max.",
    ],
    [
      { name: "Team line", values: [{ ...DOT_LIFT, step: 0 }] },
      "The round's --dot-lift has a step that isn't above 0.",
    ],
    [
      { name: "Team line", values: [{ ...DOT_LIFT, unit: undefined }] },
      'The round\'s --dot-lift needs a unit, like "px", or "" for none.',
    ],
    [
      { name: "Team line", values: [{ ...TAG_CASE, options: ["none"] }] },
      "The round's --tag-case lists fewer than two options, or one that isn't text.",
    ],
    [{ name: "Team line", values: [DOT_LIFT, DOT_LIFT] }, "The round lists --dot-lift twice."],
  ];
  for (const [round, message] of problems)
    assert.throws(() => readRound(JSON.stringify(round)), { message });
});

test("grouped alignment controls retain their vertical movement and reject malformed controls", () => {
  const value = { ...DOT_LIFT, group: "Team", isVertical: true };
  assert.deepEqual(readRound(JSON.stringify({ name: "Alignment", values: [value] })).values, [
    value,
  ]);
  for (const change of [{ group: "" }, { group: 1 }, { isVertical: "true" }])
    assert.throws(() =>
      readRound(JSON.stringify({ name: "Alignment", values: [{ ...value, ...change }] })),
    );
});

test("offset keys move down on the left and up on the right, with matching vertical arrows", () => {
  assert.equal(findOffsetNudge("ArrowLeft"), 1);
  assert.equal(findOffsetNudge("ArrowDown"), 1);
  assert.equal(findOffsetNudge("ArrowRight"), -1);
  assert.equal(findOffsetNudge("ArrowUp"), -1);
  assert.equal(findOffsetNudge("Tab"), null);
});

test("a value's number reads from its CSS text in the slider's unit, a bare 0 too", () => {
  assert.equal(readNumber(" 0.5px", DOT_LIFT), 0.5);
  assert.equal(readNumber("-1.25px", DOT_LIFT), -1.25);
  assert.equal(readNumber("-.5px", DOT_LIFT), -0.5);
  assert.equal(readNumber("0", DOT_LIFT), 0);
  assert.equal(readNumber("1em", DOT_LIFT), null);
  assert.equal(readNumber("1", DOT_LIFT), null);
  assert.equal(readNumber("calc(1px + 1px)", DOT_LIFT), null);
  assert.equal(readNumber("", DOT_LIFT), null);
  assert.equal(readNumber("0.8", { ...DOT_LIFT, unit: "" }), 0.8);
});

test("a slider's value holds to its steps and its range, and writes no float noise", () => {
  assert.equal(writeNumber(0.3, DOT_LIFT), "0.25px");
  assert.equal(writeNumber(0.4, DOT_LIFT), "0.5px");
  assert.equal(writeNumber(5, DOT_LIFT), "2px");
  assert.equal(writeNumber(-5, DOT_LIFT), "-2px");
  assert.equal(writeNumber(-0.1, DOT_LIFT), "0px");
  const tenths = { ...DOT_LIFT, min: 0, max: 1, step: 0.1 };
  assert.equal(writeNumber(0.1 + 0.2, tenths), "0.3px");
  assert.equal(writeNumber(5, tenths), "1px");
  const offGrid = { ...DOT_LIFT, min: -0.3, max: 1, step: 0.5 };
  assert.equal(writeNumber(0.1, offGrid), "0.2px");
  assert.equal(writeNumber(1, offGrid), "0.7px");
  const halfStart = { ...DOT_LIFT, min: 0.5, max: 5, step: 1 };
  assert.equal(writeNumber(1.4, halfStart), "1.5px");
  assert.equal(nudgeNumber("4.5px", halfStart, 1), "4.5px");
  assert.equal(writeNumber(3, { ...DOT_LIFT, min: 0, max: 2.5, step: 1 }), "2px");
  assert.equal(writeNumber(0.3, { ...DOT_LIFT, min: 0, max: 0.3, step: 0.1 }), "0.3px");
});

test("a slider's arrows move it a step at a time and stop at its ends", () => {
  assert.equal(nudgeNumber("0.5px", DOT_LIFT, 1), "0.75px");
  assert.equal(nudgeNumber("0.5px", DOT_LIFT, -1), "0.25px");
  assert.equal(nudgeNumber("2px", DOT_LIFT, 1), "2px");
  assert.equal(nudgeNumber("-2px", DOT_LIFT, -1), "-2px");
  assert.equal(nudgeNumber("0.6px", DOT_LIFT, 1), "0.75px");
});

test("values kept from before come back only while the page's starts are the ones they were tuned from", () => {
  const starts = { "--dot-lift": "0.5px", "--tag-case": "none" };
  const values = { "--dot-lift": "1px", "--tag-case": "uppercase" };
  assert.deepEqual(restoreSettings(starts, { starts, values }), values);
  assert.deepEqual(
    restoreSettings(starts, { starts: { ...starts, "--dot-lift": "0px" }, values }),
    starts,
  );
  assert.deepEqual(restoreSettings(starts, null), starts);
  assert.deepEqual(restoreSettings(starts, { starts, values: { "--dot-lift": "1px" } }), {
    "--dot-lift": "1px",
    "--tag-case": "none",
  });
});

test("Copy writes the round's name and every value, one a line, in the round's order", () => {
  const settings = { "--tag-case": "uppercase", "--dot-lift": "0.75px" };
  assert.equal(
    writeCopyText(ROUND, settings),
    "Team line\n--dot-lift: 0.75px\n--tag-case: uppercase",
  );
});
