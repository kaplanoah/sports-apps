import {
  checkCopiedAgain,
  checkDock,
  checkFailedCopy,
  checkKeptOnReload,
  checkNoPanelInProduction,
  checkOptionsAndCopy,
  checkPanelInSheetOnReload,
  checkPanelInThemes,
  checkPanelOverSheets,
  checkSliderSetsRoot,
  checkStartNotANumber,
} from "../../../../tests/browser/tuning-panel.mjs";
import { test, openApp } from "./harness.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const APP = "mlb";

test("a slider's arrows, its range, and its reset set its value on :root", ({ page }) =>
  checkSliderSetsRoot({ page, app: APP, openApp }));

test("an option sets its value on :root, Copy hands over every value, and its reset unsets it", ({
  page,
}) => checkOptionsAndCopy({ page, app: APP, openApp }));

test("a second Copy says Copied for its own full time", ({ page }) =>
  checkCopiedAgain({ page, app: APP, openApp }));

test("a copy the browser refuses shows the values to copy by hand", ({ page }) =>
  checkFailedCopy({ page, app: APP, openApp }));

test("the panel moves to the top and back, and stays there through a reload", ({ page }) =>
  checkDock({ page, app: APP, openApp }));

test("a slider whose start isn't a number in its unit says so", ({ page }) =>
  checkStartNotANumber({ page, app: APP, openApp }));

test("the panel keeps its values through a reload, and closes to its Tune button", ({ page }) =>
  checkKeptOnReload({ page, app: APP, openApp }));

test("the panel moves into an open sheet and still takes taps there", ({ page }) =>
  checkPanelOverSheets({ page, app: APP, openApp }));

test("a reload with a sheet open starts the panel inside it", ({ page }) =>
  checkPanelInSheetOnReload({ page, app: APP, openApp }));

test("the panel's text keeps its roles and contrast in both themes", ({ page }) =>
  checkPanelInThemes({ page, app: APP, openApp }));

test("a production page never loads the panel, even with a round open", ({ page }) =>
  checkNoPanelInProduction({ page, app: APP, openApp }));
