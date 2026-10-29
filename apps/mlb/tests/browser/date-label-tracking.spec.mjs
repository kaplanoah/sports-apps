import { test, expect, openApp } from "./harness.mjs";
import { testDateLabelTracking } from "../../../../tests/browser/date-label-tracking.mjs";

testDateLabelTracking(test, expect, {
  openApp,
  today: "2026-09-24",
  font: "Libre Franklin",
  size: 12,
  weight: 450,
  labelTracking: 0.055,
});
