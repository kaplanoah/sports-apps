// The tuning panel beta loads while a round is open: its Tune button, a slider's arrows and reset,
// option buttons, Copy and the text it shows where copying fails, its dock at the top or bottom,
// and its place over a sheet, in each of the app's themes, and a production page that never loads
// it.

import { expect } from "@playwright/test";
import { listLowContrastText } from "./contrast.mjs";
import { buildTuningServer, servePageFiles } from "./release-worker.mjs";
import { SETTINGS, openSettings } from "./settings.mjs";
import { THEMES, showTheme } from "./theme-layout.mjs";
import { listTextOffRoles, measureFieldFace, readRole } from "./type-roles.mjs";
import { SENT_MS } from "../../shared/page/sent-label.js";
import { readRound } from "../../shared/page/tuning-round.js";
import { readRepoFile } from "../repo-files.js";
import { openSeasonPart } from "./season-tab.mjs";

const CORNERS = "--radius-control";
const ALIGN = "--sample-align";
const SAMPLE_ROUND = {
  name: "Sample round",
  values: [
    { property: CORNERS, label: "Control corners", min: 0, max: 12, step: 0.5, unit: "px" },
    { property: ALIGN, label: "Sample align", options: ["start", "center"] },
  ],
};

/**
 * @typedef {{
 *   page: import("@playwright/test").Page,
 *   app: string,
 *   openApp: (page: import("@playwright/test").Page) => Promise<unknown>,
 * }} App
 */

/** @param {import("@playwright/test").Page} page */
const findPanel = (page) => page.getByRole("region", { name: "Tuning" });

/** @param {import("@playwright/test").Page} page */
const findToggle = (page) => page.getByRole("button", { name: "Tune", exact: true });

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} property
 */
const findRow = (page, property) => findPanel(page).locator(`[data-property="${property}"]`);

/**
 * The value the page itself sets on :root, apart from what its stylesheets do.
 * @param {import("@playwright/test").Page} page
 * @param {string} property
 */
const readSetOnRoot = (page, property) =>
  page.evaluate((name) => document.documentElement.style.getPropertyValue(name), property);

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} property
 */
const readOnRoot = (page, property) =>
  page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    property,
  );

/**
 * Keeps each text the page copies, since a test's browser may not hand a page the clipboard.
 * @param {import("@playwright/test").Page} page
 */
const keepCopies = (page) =>
  page.addInitScript(() => {
    const copies = /** @type {string[]} */ ([]);
    Object.assign(window, { copies });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (/** @type {string} */ text) => void copies.push(text) },
    });
  });

/**
 * Has the page's next copy fail, as a browser that won't hand a page the clipboard does.
 * @param {import("@playwright/test").Page} page
 */
const refuseCopies = (page) =>
  page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error("Refused"));
  });

/**
 * Opens the app as beta serves it while a round is open, with the panel open.
 * @param {App} app
 * @param {import("../../shared/page/tuning-round.js").Round} [round]
 * @param {(page: import("@playwright/test").Page) => Promise<unknown>} [showView]
 */
async function openTuning({ page, app, openApp }, round = SAMPLE_ROUND, showView) {
  await keepCopies(page);
  await servePageFiles(page, buildTuningServer(app, round, "beta"));
  await openApp(page);
  if (showView) await showView(page);
  await findToggle(page).click();
  await expect(findPanel(page)).toBeVisible();
  await expect(findToggle(page)).toBeHidden();
}

/**
 * A slider's arrows step its value on :root, the slider sets any value on its grid, and its reset
 * takes the value off :root, back to where the app's stylesheet puts it, and turns itself off.
 * @param {App} app
 */
export async function checkSliderSetsRoot(app) {
  const { page } = app;
  await openTuning(app);
  const start = await readOnRoot(page, CORNERS);
  const row = findRow(page, CORNERS);
  const reset = row.getByRole("button", { name: "Reset Control corners" });
  await expect(row.locator("output")).toHaveText(start);
  await expect(reset).toBeDisabled();

  await row.getByRole("button", { name: "Control corners a step up" }).click();
  const stepped = `${parseFloat(start) + 0.5}px`;
  await expect(row.locator("output")).toHaveText(stepped);
  expect(await readSetOnRoot(page, CORNERS)).toBe(stepped);
  await expect(reset).toBeEnabled();

  await row.getByRole("slider", { name: "Control corners" }).fill("8.5");
  await expect(row.locator("output")).toHaveText("8.5px");
  expect(await readOnRoot(page, CORNERS)).toBe("8.5px");
  await row.getByRole("button", { name: "Control corners a step down" }).click();
  await expect(row.locator("output")).toHaveText("8px");
  await expect(row.getByRole("slider")).toHaveValue("8");

  await reset.click();
  await expect(row.locator("output")).toHaveText(start);
  await expect(row.getByRole("slider")).toHaveValue(String(parseFloat(start)));
  expect(await readSetOnRoot(page, CORNERS)).toBe("");
  await expect(reset).toBeDisabled();
}

/**
 * An option button sets its value on :root and shows as pressed, and Copy hands over the round's
 * name and every value as text to paste back.
 * @param {App} app
 */
export async function checkOptionsAndCopy(app) {
  const { page } = app;
  await openTuning(app);
  const row = findRow(page, ALIGN);
  await expect(row.locator("output")).toHaveText("not set");
  await row.getByRole("button", { name: "center" }).click();
  await expect(row.getByRole("button", { name: "center" })).toHaveAttribute("aria-pressed", "true");
  await expect(row.getByRole("button", { name: "start" })).toHaveAttribute("aria-pressed", "false");
  expect(await readSetOnRoot(page, ALIGN)).toBe("center");

  const corners = await readOnRoot(page, CORNERS);
  await findPanel(page).getByRole("button", { name: "Copy" }).click();
  await expect(findPanel(page).getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => /** @type {any} */ (window).copies)).toEqual([
    `Sample round\n${CORNERS}: ${corners}\n${ALIGN}: center`,
  ]);

  await row.getByRole("button", { name: "Reset Sample align" }).click();
  await expect(row.locator("output")).toHaveText("not set");
  await expect(row.getByRole("button", { name: "center" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(await readSetOnRoot(page, ALIGN)).toBe("");
}

/**
 * A second Copy while the first still says so says it for its own full time.
 * @param {App} app
 */
export async function checkCopiedAgain(app) {
  const { page } = app;
  await openTuning(app);
  const copy = findPanel(page).locator(".tuning-copy");
  await copy.click();
  await expect(copy).toHaveText("Copied");
  await page.clock.runFor(SENT_MS * 0.75);
  await copy.click();
  await page.clock.runFor(SENT_MS * 0.5);
  await expect(copy).toHaveText("Copied");
  await page.clock.runFor(SENT_MS * 0.5);
  await expect(copy).toHaveText("Copy");
}

/**
 * Where the browser won't take the copy, Copy says so and shows the values as text to copy by hand.
 * @param {App} app
 */
export async function checkFailedCopy(app) {
  const { page } = app;
  await openTuning(app);
  const corners = await readOnRoot(page, CORNERS);
  await refuseCopies(page);
  await findPanel(page).getByRole("button", { name: "Copy" }).click();
  await expect(findPanel(page).getByRole("button", { name: "Copy below" })).toBeVisible();
  await expect(findPanel(page).getByRole("textbox", { name: "Values to copy" })).toHaveValue(
    `Sample round\n${CORNERS}: ${corners}\n${ALIGN}: `,
  );
}

/**
 * The panel moves to the top of the screen and back, with its Tune button, and stays where it
 * was put through a reload.
 * @param {App} app
 */
export async function checkDock(app) {
  const { page } = app;
  await openTuning(app);
  await expect(findPanel(page)).toHaveAttribute("data-dock", "bottom");
  await findPanel(page).getByRole("button", { name: "Move to the top" }).click();
  await expect(findPanel(page)).toHaveAttribute("data-dock", "top");

  await page.reload();
  await expect(findPanel(page)).toHaveAttribute("data-dock", "top");
  await findPanel(page).getByRole("button", { name: "Close tuning" }).click();
  await expect(findToggle(page)).toHaveAttribute("data-dock", "top");
  await findToggle(page).click();
  await findPanel(page).getByRole("button", { name: "Move to the bottom" }).click();
  await expect(findPanel(page)).toHaveAttribute("data-dock", "bottom");
}

/**
 * A slider whose start on :root isn't a number in its unit says so, rather than a slider that
 * starts from nothing.
 * @param {App} app
 */
export async function checkStartNotANumber(app) {
  const { page } = app;
  const unset = "--sample-unset";
  await openTuning(app, {
    name: "Unset round",
    values: [{ property: unset, label: "Unset", min: 0, max: 4, step: 1, unit: "px" }],
  });
  const row = findRow(page, unset);
  await expect(row).toContainText(`${unset} isn't a number in px on :root`);
  await expect(row.getByRole("slider")).toHaveCount(0);
}

/**
 * The panel keeps what was set, and whether it was open, through a reload, and its close leaves
 * the Tune button that opens it again.
 * @param {App} app
 */
export async function checkKeptOnReload(app) {
  const { page } = app;
  await openTuning(app);
  const row = findRow(page, CORNERS);
  await row.getByRole("slider", { name: "Control corners" }).fill("10");
  await page.reload();
  await expect(findRow(page, CORNERS).locator("output")).toHaveText("10px");
  expect(await readSetOnRoot(page, CORNERS)).toBe("10px");

  await findPanel(page).getByRole("button", { name: "Close tuning" }).click();
  await expect(findPanel(page)).toBeHidden();
  await findToggle(page).click();
  await expect(findPanel(page)).toBeVisible();
}

/**
 * A sheet leaves the page under it untouchable, so the panel moves into the sheet on top and still
 * takes taps there, and back out once it closes.
 * @param {App} app
 */
export async function checkPanelOverSheets(app) {
  const { page } = app;
  await openTuning(app);
  await openSettings(page);
  await expect(page.locator(SETTINGS)).toBeVisible();
  await expect(page.locator(`${SETTINGS} .tuning-panel`)).toHaveCount(1);
  await findRow(page, ALIGN).getByRole("button", { name: "start" }).click();
  expect(await readSetOnRoot(page, ALIGN)).toBe("start");

  await page.keyboard.press("Escape");
  await expect(page.locator(SETTINGS)).toBeHidden();
  await expect(page.locator("body > .tuning-panel")).toHaveCount(1);
}

/**
 * A sheet a reload puts back is open before the panel starts, so the panel starts inside it.
 * @param {App} app
 */
export async function checkPanelInSheetOnReload(app) {
  const { page } = app;
  await openTuning(app);
  await openSettings(page);
  await expect(page.locator(SETTINGS)).toBeVisible();
  await page.reload();
  await expect(page.locator(SETTINGS)).toBeVisible();
  await expect(page.locator(`${SETTINGS} .tuning-panel`)).toHaveCount(1);
  await findRow(page, ALIGN).getByRole("button", { name: "center" }).click();
  expect(await readSetOnRoot(page, ALIGN)).toBe("center");
}

/**
 * The panel's text, the values shown to copy by hand too, keeps its type roles and reads clearly
 * in both of the app's themes.
 * @param {App} app
 */
export async function checkPanelInThemes(app) {
  const { page } = app;
  await openTuning(app);
  await refuseCopies(page);
  await findPanel(page).getByRole("button", { name: "Copy" }).click();
  const copyText = findPanel(page).getByRole("textbox", { name: "Values to copy" });
  await expect(copyText).toBeVisible();
  const widths = await measureFieldFace(copyText, "--type-body-size");
  expect(widths.field).toBeCloseTo(widths.role, 0);
  expect(await copyText.evaluate((field) => Number(getComputedStyle(field).fontWeight))).toBe(
    (await readRole(page, "body")).weight,
  );
  for (const theme of THEMES) {
    await showTheme(page, theme);
    expect(await listTextOffRoles(page), theme).toEqual([]);
    expect(await listLowContrastText(page), theme).toEqual([]);
  }
}

/**
 * A production page, with a round open, shows no Tune button and never asks for the panel.
 * @param {App} app
 */
export async function checkNoPanelInProduction({ page, app, openApp }) {
  const asked = /** @type {string[]} */ ([]);
  page.on("request", (request) => {
    if (request.url().includes("tuning")) asked.push(request.url());
  });
  await servePageFiles(page, buildTuningServer(app, SAMPLE_ROUND, null));
  await openApp(page);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(findToggle(page)).toHaveCount(0);
  await expect(page.locator(".tuning-panel")).toHaveCount(0);
  expect(asked).toEqual([]);
}

/** @param {string} app */
const readAlignmentRound = (app) => readRound(readRepoFile(`apps/${app}/page/tuning-round.json`));

/**
 * @param {import("@playwright/test").Locator} element
 */
const readMiddle = (element) =>
  element.evaluate((part) => {
    const box = part.getBoundingClientRect();
    return box.top + box.height / 2;
  });

/**
 * @param {App} app
 * @param {{ width: number, colorScheme: "light" | "dark" }} look
 */
export async function checkAlignmentControls(app, { width, colorScheme }) {
  const { page } = app;
  const round = readAlignmentRound(app.app);
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme });
  await openTuning(app, round, (shown) =>
    shown.getByRole("tab", { name: "Games", exact: true }).click(),
  );
  const group = findPanel(page).getByRole("combobox", { name: "Role" });
  for (const name of ["Small", "Team", "Large", "Label"]) {
    await group.selectOption(name);
    await expect(findPanel(page).locator(".tuning-row")).toHaveCount(
      round.values.filter((value) => value.group === name).length,
    );
    await expect(findPanel(page).locator(".tuning-note")).toHaveCount(0);
  }
  await group.selectOption("Team");
  const club = page.locator("#seasonGames .game-side.away .club").first();
  const dot = club.locator(":scope > .dot");
  const name = club.locator(".team-name");
  await expect(dot).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const size = parseFloat(await name.evaluate((part) => getComputedStyle(part).fontSize));
  const sizeRow = findRow(page, "--type-team-size");
  await expect(sizeRow.locator("output")).toHaveText(`${size}px`);
  await sizeRow.getByRole("slider").fill(String(size + 0.25));
  await expect(name).toHaveCSS("font-size", `${size + 0.25}px`);
  await sizeRow.getByRole("button", { name: "Reset Name size" }).click();
  await expect(name).toHaveCSS("font-size", `${size}px`);
  expect(await readSetOnRoot(page, "--type-team-size")).toBe("");

  const offsetRow = findRow(page, "--team-dot-before");
  const start = parseFloat(await offsetRow.locator("output").textContent());
  const before = (await readMiddle(dot)) - (await readMiddle(name));
  await offsetRow.getByRole("button", { name: "Dot before name down", exact: true }).click();
  await expect(offsetRow.locator("output")).toHaveText(`${start + 0.25}px`);
  expect((await readMiddle(dot)) - (await readMiddle(name))).toBeCloseTo(before + 0.25, 2);
  const slider = offsetRow.getByRole("slider");
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(offsetRow.locator("output")).toHaveText(`${start}px`);
  await page.keyboard.press("ArrowLeft");
  await expect(offsetRow.locator("output")).toHaveText(`${start + 0.25}px`);
  await page.keyboard.press("ArrowUp");
  await expect(offsetRow.locator("output")).toHaveText(`${start}px`);
  await page.keyboard.press("ArrowDown");
  await expect(offsetRow.locator("output")).toHaveText(`${start + 0.25}px`);
  await offsetRow.getByRole("button", { name: "Reset Dot before name" }).click();
  const box = await slider.boundingBox();
  await slider.tap({ position: { x: box.width * 0.25, y: box.height / 2 } });
  expect(parseFloat(await offsetRow.locator("output").textContent())).toBeGreaterThan(start);
  expect((await readMiddle(dot)) - (await readMiddle(name))).toBeGreaterThan(before);
  await offsetRow.getByRole("button", { name: "Reset Dot before name" }).click();
  expect((await readMiddle(dot)) - (await readMiddle(name))).toBeCloseTo(before, 2);
  const home = page.locator("#seasonGames .game-side.home .club").first();
  const homeDot = home.locator(":scope > .dot");
  const homeName = home.locator(".team-name");
  const homeBefore = (await readMiddle(homeDot)) - (await readMiddle(homeName));
  const afterRow = findRow(page, "--team-dot-after");
  const afterStart = parseFloat(await afterRow.locator("output").textContent());
  await afterRow.getByRole("button", { name: "Dot after name down" }).click();
  await expect(afterRow.locator("output")).toHaveText(`${afterStart + 0.25}px`);
  expect((await readMiddle(homeDot)) - (await readMiddle(homeName))).toBeCloseTo(
    homeBefore + 0.25,
    2,
  );
  await afterRow.getByRole("button", { name: "Reset Dot after name" }).click();
  expect((await readMiddle(homeDot)) - (await readMiddle(homeName))).toBeCloseTo(homeBefore, 2);
  await expect(page.locator("#seasonGames")).toBeVisible();
}

/**
 * @param {App} app
 */
export async function checkAlignmentAttachments(app) {
  const { page } = app;
  await openTuning(app, readAlignmentRound(app.app), (shown) =>
    openSeasonPart(shown, app.app === "mlb" ? "Bracket" : "Standings"),
  );
  const group = findPanel(page).getByRole("combobox", { name: "Role" });
  await group.selectOption("Team");
  const property = app.app === "mlb" ? "--team-rank-offset" : "--team-conference-offset";
  const selector =
    app.app === "mlb" ? "#bracketWrap .rank-tag" : "#standings-league .conference-tag";
  const attachment = page.locator(selector).first();
  await expect(attachment).toBeVisible();
  const before = await readMiddle(attachment);
  const row = findRow(page, property);
  const start = parseFloat(await row.locator("output").textContent());
  await row.getByRole("button", { name: / down$/ }).click();
  await expect(row.locator("output")).toHaveText(`${start + 0.25}px`);
  expect(await readMiddle(attachment)).toBeCloseTo(before + 0.25, 2);
  await row.getByRole("button", { name: /^Reset / }).click();
  expect(await readMiddle(attachment)).toBeCloseTo(before, 2);
  if (app.app !== "wnba") return;

  await openSeasonPart(page, "Bracket");
  await group.selectOption("Large");
  const outside = page.locator(".seed-label").first();
  await expect(outside).toBeVisible();
  const pieces = [outside, outside.locator(".seed-number"), outside.locator(".seed-word")];
  const starts = await Promise.all(pieces.map(readMiddle));
  const outsideRow = findRow(page, "--team-outside-seed-offset");
  await outsideRow.getByRole("button", { name: "Outside seed label down" }).click();
  for (const [index, piece] of pieces.entries())
    expect(await readMiddle(piece)).toBeCloseTo(starts[index] + 0.25, 2);
  await outsideRow.getByRole("button", { name: "Reset Outside seed label" }).click();
  expect(await readMiddle(outside)).toBeCloseTo(starts[0], 2);
}

/** @param {App} app */
async function setAlignmentChoices(app) {
  const { page } = app;
  const round = readAlignmentRound(app.app);
  await openTuning(app, round);
  const group = findPanel(page).getByRole("combobox", { name: "Role" });
  await group.selectOption("Small");
  const small = findRow(page, "--type-team-small-size");
  const start = parseFloat(await small.locator("output").textContent());
  await small.getByRole("slider").fill(String(start + 0.25));
  await group.selectOption("Large");
  const large = findRow(page, "--team-large-dot-size");
  await large.getByRole("slider").fill("16.5");
  return { round, group, small, large, start };
}

/** @param {App} app */
export async function checkAlignmentCopy(app) {
  const { page } = app;
  const { round, start } = await setAlignmentChoices(app);
  await findPanel(page).getByRole("button", { name: "Copy", exact: true }).click();
  const copies = await page.evaluate(() => /** @type {any} */ (window).copies);
  const lines = copies[0].split("\n");
  expect(lines).toHaveLength(round.values.length + 1);
  expect(lines[0]).toBe(round.name);
  for (const value of round.values)
    expect(lines.some((line) => line.startsWith(`${value.property}: `))).toBe(true);
  expect(lines).toContain(`--type-team-small-size: ${start + 0.25}px`);
  expect(lines).toContain("--team-large-dot-size: 16.5px");
}

/** @param {App} app */
export async function checkAlignmentReloadAndReset(app) {
  const { page } = app;
  const { group, small, large, start } = await setAlignmentChoices(app);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(group).toHaveValue("Large");
  await expect(large.locator("output")).toHaveText("16.5px");
  await large.getByRole("button", { name: "Reset Dot size" }).click();
  await expect(large.locator("output")).toHaveText("16px");
  await group.selectOption("Small");
  await expect(small.locator("output")).toHaveText(`${start + 0.25}px`);
  await small.getByRole("button", { name: "Reset Name size" }).click();
  expect(await readSetOnRoot(page, "--type-team-small-size")).toBe("");
}

/** @param {App} app */
export async function checkAlignmentStaysOutOfProduction(app) {
  const { page } = app;
  const round = readAlignmentRound(app.app);
  await openTuning(app, round);
  await findPanel(page).getByRole("combobox", { name: "Role" }).selectOption("Team");
  const row = findRow(page, "--type-team-size");
  const start = parseFloat(await row.locator("output").textContent());
  await row.getByRole("slider").fill(String(start + 1));
  const production = await page.context().newPage();
  const requests = [];
  production.on("request", (request) => {
    if (request.url().includes("tuning")) requests.push(request.url());
  });
  await servePageFiles(production, buildTuningServer(app.app, round, null));
  await app.openApp(production);
  await production.getByRole("tab", { name: "Games", exact: true }).click();
  const name = production.locator("#seasonGames .team-name").first();
  await expect(name).toBeVisible();
  await expect(name).toHaveCSS("font-size", `${start}px`);
  await expect(findToggle(production)).toHaveCount(0);
  expect(await readSetOnRoot(production, "--type-team-size")).toBe("");
  expect(requests).toEqual([]);
  await production.close();
}

/**
 * @param {import("@playwright/test").Locator} line
 * @param {string} nameSelector
 */
const readDotOffset = (line, nameSelector) =>
  line.evaluate((element, selector) => {
    const dot = element.querySelector(":scope > .dot").getBoundingClientRect();
    const name = element.querySelector(selector).getBoundingClientRect();
    return dot.top + dot.height / 2 - name.top - name.height / 2;
  }, nameSelector);

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} role
 * @param {import("@playwright/test").Locator} line
 * @param {string} nameSelector
 * @param {import("../../shared/page/tuning-round.js").Round} round
 * @param {string} label
 */
async function checkRoleControl(page, role, line, nameSelector, round, label) {
  await expect(line).toBeVisible();
  await findPanel(page).getByRole("combobox", { name: "Role" }).selectOption(role);
  await page.evaluate(() => document.fonts.ready);
  const value = round.values.find((each) => each.group === role && each.label === label);
  if (!value || !("step" in value)) throw new Error(`No slider for ${role} ${label}`);
  const row = findRow(page, value.property);
  if (label === "Dot before name") {
    const before = await readDotOffset(line, nameSelector);
    await row.getByRole("button", { name: "Dot before name down", exact: true }).click();
    expect(await readDotOffset(line, nameSelector)).toBeCloseTo(before + value.step, 2);
    await row.getByRole("button", { name: "Reset Dot before name", exact: true }).click();
    expect(await readDotOffset(line, nameSelector)).toBeCloseTo(before, 2);
    return;
  }
  const css = { "Name size": "font-size", "Name weight": "font-weight", "Dot size": "width" }[
    label
  ];
  const element = label === "Dot size" ? line.locator(":scope > .dot") : line.locator(nameSelector);
  const before = await element.evaluate(
    (part, property) => getComputedStyle(part).getPropertyValue(property),
    css,
  );
  await row.getByRole("button", { name: `${label} a step up`, exact: true }).click();
  await expect(element).toHaveCSS(
    css,
    `${parseFloat(before) + value.step}${css === "font-weight" ? "" : "px"}`,
  );
  await page.evaluate(() => document.fonts.ready);
  await row.getByRole("button", { name: `Reset ${label}`, exact: true }).click();
  await expect(element).toHaveCSS(css, before);
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} role
 */
async function showAlignmentRole(page, role) {
  if (role === "Team" || role === "Label") {
    await page.getByRole("tab", { name: role === "Team" ? "Games" : "News", exact: true }).click();
    return;
  }
  await openSeasonPart(page, "Bracket");
  await page.locator("#bracketWrap .team-open").first().click();
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} role
 */
function findAlignmentRole(page, role) {
  if (role === "Team")
    return { line: page.locator("#seasonGames .game-side.away .club").first(), name: ".team-name" };
  if (role === "Label")
    return { line: page.locator(".news-teams .club").first(), name: ".team-name" };
  if (role === "Large")
    return { line: page.locator("#teamSheet .team-title"), name: ":scope > span:not(.dot)" };
  return { line: page.locator("#teamSheet .game-card-opponent").first(), name: ".game-card-name" };
}

/**
 * @param {App} app
 * @param {string} role
 * @param {string} label
 */
export async function checkAlignmentRoleControl(app, role, label) {
  const { page } = app;
  await page.setViewportSize({ width: 1280, height: 900 });
  const round = readAlignmentRound(app.app);
  await openTuning(app, round, (shown) => showAlignmentRole(shown, role));
  const { line, name } = findAlignmentRole(page, role);
  await checkRoleControl(page, role, line, name, round, label);
}

/** @param {App} app */
export async function checkAlignmentCardFit(app) {
  const { page } = app;
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTuning(app, readAlignmentRound(app.app), (shown) => showAlignmentRole(shown, "Small"));
  await findPanel(page).getByRole("combobox", { name: "Role" }).selectOption("Small");
  const sizeRow = findRow(page, "--type-team-small-size");
  await sizeRow.getByRole("slider").fill("18");
  await expect(sizeRow.locator("output")).toHaveText("18px");
  const cards = page.locator("#teamSheet .game-cards");
  const leastPadding = await cards.evaluate((row) =>
    parseFloat(getComputedStyle(row).getPropertyValue("--game-card-padding-least")),
  );
  const readLeastInset = () =>
    cards.locator(".game-card-button").evaluateAll((buttons) =>
      Math.min(
        ...buttons.map((button) => {
          const box = button.getBoundingClientRect();
          const border = parseFloat(getComputedStyle(button).borderRightWidth);
          const opponent = button.querySelector(".game-card-opponent").getBoundingClientRect();
          return box.right - border - opponent.right;
        }),
      ),
    );
  await expect.poll(readLeastInset).toBeGreaterThanOrEqual(leastPadding - 0.1);
  await sizeRow.getByRole("button", { name: "Reset Name size" }).click();
}
