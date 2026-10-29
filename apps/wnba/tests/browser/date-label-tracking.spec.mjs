import { test, expect, openApp } from "./harness.mjs";
import { testDateLabelTracking } from "../../../../tests/browser/date-label-tracking.mjs";

testDateLabelTracking(test, expect, {
  openApp,
  today: "2026-09-30",
  font: "Barlow",
  size: 13,
  weight: 500,
  labelTracking: 0.075,
  tomorrow: { day: "2026-10-01", accessibleName: "Tomorrow, Oct 1", weight: 600 },
});
