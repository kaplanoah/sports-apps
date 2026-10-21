import {
  checkKeptOnReload,
  checkNoPanelInProduction,
  checkOptionsAndCopy,
  checkPanelInThemes,
  checkPanelOverSheets,
  checkSliderSetsRoot,
} from "../../../../tests/browser/tuning-panel.mjs";
import { test, openApp } from "./harness.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const APP = "mlb";

test("a slider's arrows, its range, and its reset set its value on :root", ({ page }) =>
  checkSliderSetsRoot({ page, app: APP, openApp }));

test("an option sets its value on :root, and Copy hands over every value", ({ page }) =>
  checkOptionsAndCopy({ page, app: APP, openApp }));

test("the panel keeps its values through a reload, and closes to its Tune button", ({ page }) =>
  checkKeptOnReload({ page, app: APP, openApp }));

test("the panel moves into an open sheet and still takes taps there", ({ page }) =>
  checkPanelOverSheets({ page, app: APP, openApp }));

test("the panel's text keeps its roles and contrast in both themes", ({ page }) =>
  checkPanelInThemes({ page, app: APP, openApp }));

test("a production page never loads the panel, even with a round open", ({ page }) =>
  checkNoPanelInProduction({ page, app: APP, openApp }));
