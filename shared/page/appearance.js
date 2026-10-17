// The settings panel's appearance choice: the app's light look, its dark one, or System to follow
// the phone. Each device keeps its own, since the page saves nothing to the store. pick-theme.js
// sets the theme before the first paint; this keeps it, and the icons and bar color that go with
// it, current. Each app hands it its looks' icons and bar colors.

// Every page that loads this runs pick-theme.js first.
/* global buildSafariAddress, isAppearanceChoice, openThemeAddress -- from pick-theme.js */

import { isIos, isOnHomeScreen } from "./device.js";
import { createViewerChoice } from "./device-storage.js";
import { html, setHtml } from "./html.js";
import { watchTimeAway } from "./resume.js";

/**
 * @typedef {{ barColor: string, tabIcon: string, homeScreenIcon: string }} Look
 * @typedef {{ light: Look, dark: Look }} Looks
 */

const darkScheme = matchMedia("(prefers-color-scheme: dark)");
const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const appearance = createViewerChoice("appearance", (stored) =>
  typeof stored === "string" && isAppearanceChoice(stored) ? stored : "auto",
);

/**
 * @param {string} choice
 * @returns {"light" | "dark"}
 */
const resolveTheme = (choice) => {
  if (choice === "light" || choice === "dark") return choice;
  return darkScheme.matches ? "dark" : "light";
};

// A phone keeps the icon a page offers at the moment it's added to the home screen, so the page
// offers the one that matches the theme showing.
/**
 * @param {Looks} looks
 * @param {"light" | "dark"} theme
 */
function showTheme(looks, theme) {
  const { barColor, tabIcon, homeScreenIcon } = looks[theme];
  document.documentElement.dataset.theme = theme;
  findElement("themeColor").setAttribute("content", barColor);
  findElement("tabIcon").setAttribute("href", tabIcon);
  findElement("homeScreenIcon").setAttribute("href", homeScreenIcon);
}

/**
 * Shows the theme the viewer picked, or the phone's for System, now and whenever the phone's
 * changes.
 * @param {Looks} looks
 * @param {() => string} readPicked
 */
function followTheme(looks, readPicked) {
  const showChosenTheme = () => showTheme(looks, resolveTheme(readPicked()));
  showChosenTheme();
  darkScheme.addEventListener("change", showChosenTheme);
  return showChosenTheme;
}

/**
 * Shows the saved look, and another tab's choice too.
 * @param {Looks} looks
 */
export function followSavedTheme(looks) {
  appearance.watch(followTheme(looks, appearance.read));
}

/** @param {NodeListOf<HTMLInputElement>} choices */
function checkSavedChoice(choices) {
  const saved = appearance.read();
  for (const choice of choices) choice.checked = choice.value === saved;
}

/**
 * @param {string} choice
 * @param {string} address
 */
function drawReAddNote(choice, address) {
  setHtml(
    findElement("appearanceNote"),
    html`Apple only sets icons when you add a site to your home screen. To update your icon,
      <a href="${buildSafariAddress(choice, address)}">re-add the site</a>`,
  );
}

// The Worker answers only a phone signed in, and only while it asks for a code.
/** @returns {Promise<{ address: string, expiresInMs: number } | null>} */
async function requestHandoff() {
  try {
    const response = await fetch("access/handoff", { method: "POST" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** @type {string | null} */
let reAddChoice = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let renewTimer;

// A handoff lasts minutes and a Home Screen app stays open for hours, so the note asks for a new
// one halfway through each, and again whenever the app comes back, since a phone freezes timers
// while it's away. A wake can come with the timer, so the last answer alone sets the next.
async function renewHandoff() {
  const choice = reAddChoice;
  if (choice === null) return;
  const handoff = await requestHandoff();
  if (handoff === null || choice !== reAddChoice) return;
  drawReAddNote(choice, handoff.address);
  clearTimeout(renewTimer);
  renewTimer = setTimeout(renewHandoff, handoff.expiresInMs / 2);
}

// An iPhone's Home Screen app keeps the icon it was added with, so a theme picked in the app
// changes its icon only once the site is added again, from Safari, which opens on the same theme.
// Safari keeps its cookies apart from the app's, so the link signs it in with a handoff from the
// Worker (access-gate.js), and until one arrives, or where none does, Safari asks for the code.
/** @param {string} choice */
function offerReAdd(choice) {
  reAddChoice = choice;
  drawReAddNote(choice, location.href);
  renewHandoff();
}

/**
 * Wires the settings' Appearance choices, and the welcome's copy of them
 * (draw-home-screen-asks.js), to the look they pick.
 * @param {Looks} looks
 */
export function startAppearance(looks) {
  const choices = /** @type {NodeListOf<HTMLInputElement>} */ (
    document.querySelectorAll('input[name="appearance"], input[name="welcomeAppearance"]')
  );
  checkSavedChoice(choices);
  const showChosenTheme = followTheme(looks, appearance.read);
  for (const choice of choices) {
    choice.addEventListener("change", () => {
      appearance.keep(choice.value);
      openThemeAddress(choice.value);
      checkSavedChoice(choices);
      showChosenTheme();
      if (choice.name === "appearance" && isOnHomeScreen() && isIos()) offerReAdd(choice.value);
    });
  }
  appearance.watch(() => {
    openThemeAddress(appearance.read());
    checkSavedChoice(choices);
    showChosenTheme();
  });
  watchTimeAway(renewHandoff);
}
