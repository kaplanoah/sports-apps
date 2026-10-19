import { test } from "node:test";
import assert from "node:assert/strict";
import { placeStandIn } from "#shared/rider-taps.js";

test("a stand-in sits in its part as far below the pill's top in the part as its button sits below the pill on the screen, however far both have ridden", () => {
  const pillTop = 300;
  const partLeft = -17;
  const atRest = placeStandIn(
    { top: 120, left: 30, width: 340, height: 44 },
    { top: 300, left: 0, width: 390, height: 54 },
    pillTop,
    partLeft,
  );
  const ridden = placeStandIn(
    { top: 40, left: 30, width: 340, height: 44 },
    { top: 220, left: 0, width: 390, height: 54 },
    pillTop,
    partLeft,
  );

  assert.deepEqual(atRest, { top: 120, left: 47, width: 340, height: 44 });
  assert.deepEqual(ridden, atRest);
});
