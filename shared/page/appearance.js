// The settings panel's appearance choice: the app's light look, its dark one, or System to follow
// the phone. Each device keeps its own, since the page saves nothing to the store. pick-theme.js
// sets the theme before the first paint; this keeps it, and the icons and bar color that go with
// it, current. Each app hands it its looks' icons and bar colors. It also draws settings' note on
// updating the icon, with both icons and an X, whose link it keeps signed in with a fresh handoff
// while settings shows it, and eases the note as the look changes, but for a change the phone
// reports as the page comes back, which takes the note to its new state at once.

// Every page that loads this runs pick-theme.js first.
/* global buildSafariAddress, checkPickedChoice, isAppearanceChoice, isLook, openThemeAddress,
   readHomeScreenIcon, readPhoneLook -- from pick-theme.js */
/* global readPageMoveIcon -- from page-move.js */

import { isIos, isOnHomeScreen } from "./device.js";
import { createViewerChoice } from "./device-storage.js";
import { renderDismissButton } from "./dismiss-button.js";
import { easeBackOpen, easeClosed, isEasingClosed, redrawEased } from "./eased-redraw.js";
import { html, noteHeight, setHtml } from "./html.js";
import {
  chooseReAddNote,
  isLookChangeOnReturn,
  isLookSwitched,
  isReAddNoteDismissed,
  keepLookSwitched,
  keepReAddNoteDismissed,
} from "./re-add-note.js";
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
const resolveTheme = (choice) => (isLook(choice) ? choice : readPhoneLook());

// A phone keeps the icon a page offers at the moment it's added to the home screen, so the page
// offers the one that matches the theme showing, or, while a move is being finished, the one
// picked for it.
/**
 * @param {Looks} looks
 * @param {"light" | "dark"} theme
 */
function showTheme(looks, theme) {
  const { barColor, tabIcon } = looks[theme];
  document.documentElement.dataset.theme = theme;
  findElement("themeColor").setAttribute("content", barColor);
  findElement("tabIcon").setAttribute("href", tabIcon);
  findElement("homeScreenIcon").setAttribute(
    "href",
    looks[readPageMoveIcon() ?? theme].homeScreenIcon,
  );
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
const checkSavedChoice = (choices) => checkPickedChoice(choices, appearance.read());

const APPEARANCE_CHOICES = 'input[name="appearance"], input[name="welcomeAppearance"]';

const findAppearanceChoices = () =>
  /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll(APPEARANCE_CHOICES));

const findSettings = () => findElement("settingsDialog");
const findNote = () => findElement("appearanceNote");

const isIosApp = () => isOnHomeScreen() && isIos();

function readNote() {
  const choice = appearance.read();
  return chooseReAddNote({
    isIosApp: isIosApp(),
    choice,
    picked: resolveTheme(choice),
    icon: readHomeScreenIcon(),
    isSwitched: isLookSwitched(),
    isDismissed: isReAddNoteDismissed(),
  });
}

// Phosphor's arrow-right, at its Regular weight, as in a line of text.
const ARROW = html`<svg class="re-add-arrow" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"
  />
</svg>`;

/** @type {string | null} */
let handoffAddress = null;

// An iPhone's Home Screen app keeps the icon it was added with, so a theme picked in the app
// changes its icon only once the site is added again, from Safari, which opens on the same theme.
// Safari keeps its cookies apart from the app's, so the link signs it in with a handoff from the
// Worker (access-gate.js), and until one arrives, or where none does, Safari asks for the code.
/** @param {{ icon: "light" | "dark", picked: "light" | "dark", choice: string }} note */
const renderNote = ({ icon, picked, choice }) => {
  const reAddAddress = buildSafariAddress(choice, handoffAddress ?? location.href);
  return html`<span class="re-add-icons" aria-hidden="true"
      ><span class="home-screen-icon" data-look="${icon}"></span>${ARROW}<span
        class="home-screen-icon"
        data-look="${picked}"
      ></span></span
    ><span class="control-note"
      >Apple only sets icons when you add a site to your home screen. To update your icon,
      <a href="${reAddAddress}">re-add the site</a></span
    >${renderDismissButton({ id: "dismissReAddNote", label: "Dismiss icon note" })}`;
};

function drawNote() {
  const note = readNote();
  setHtml(findNote(), note ? renderNote(note) : html``);
}

function showNote() {
  const note = findNote();
  if (isEasingClosed(note)) {
    easeBackOpen(note, drawNote);
    return;
  }
  redrawEased(() => {
    noteHeight(note);
    drawNote();
  });
}

function hideNote() {
  const note = findNote();
  if (note.childElementCount > 0) easeClosed(note, () => setHtml(note, html``));
}

// The note eases in as a pick sets the icon off and out as one brings it back or the X dismisses
// it, and its link's handoff follows.
function updateNote() {
  if (readNote()) showNote();
  else hideNote();
  followHandoff();
}

const HANDOFF_RETRY_MS = 30 * 1000;

// The Worker makes one only for a phone signed in, and only while it asks for a code, so only a
// read that didn't reach it, or that it failed, is worth trying again.
/** @returns {Promise<{ address: string, expiresInMs: number } | "none" | "failed">} */
async function requestHandoff() {
  try {
    const response = await fetch("access/handoff", { method: "POST" });
    if (response.ok) return await response.json();
    return response.status < 500 ? "none" : "failed";
  } catch {
    return "failed";
  }
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let renewTimer;
let renewDueAt = Infinity;
let isAskingForHandoff = false;

/** @param {number} delayMs */
function scheduleRenewal(delayMs) {
  clearTimeout(renewTimer);
  renewDueAt = Date.now() + delayMs;
  renewTimer = setTimeout(renewHandoff, delayMs);
}

function stopRenewals() {
  clearTimeout(renewTimer);
  renewDueAt = Infinity;
}

// The note's link needs a handoff only while settings shows it.
const isHandoffWanted = () =>
  /** @type {HTMLDialogElement} */ (findSettings()).open && readNote() !== null;

// A handoff lasts minutes and settings can stay open longer, so the note asks for a new one
// halfway through each.
async function renewHandoff() {
  stopRenewals();
  isAskingForHandoff = true;
  const answer = await requestHandoff();
  isAskingForHandoff = false;
  if (!isHandoffWanted()) return;
  if (answer === "failed") {
    scheduleRenewal(HANDOFF_RETRY_MS);
    return;
  }
  handoffAddress = answer === "none" ? null : answer.address;
  drawNote();
  if (answer !== "none") scheduleRenewal(answer.expiresInMs / 2);
}

// A handoff kept while the note is away would be stale by the time it shows again.
function followHandoff() {
  if (isHandoffWanted()) {
    if (renewDueAt === Infinity && !isAskingForHandoff) renewHandoff();
    return;
  }
  stopRenewals();
  handoffAddress = null;
}

// A phone freezes the page's timers while it's away, and short trips away leave settings open, so
// a renewal they held back goes out as the page comes back.
function renewIfDue() {
  if (Date.now() >= renewDueAt) renewHandoff();
}

// A page that opens reads the phone's look as it opens, so only a return counts.
let shownAt = -Infinity;

function keepReturnTime() {
  shownAt = performance.now();
}

// A close frozen while the page was away would finish once it's back and empty the note drawn
// meanwhile, so it stops, and the note opens from wherever the close reached.
function drawNoteAtOnce() {
  const note = findNote();
  if (isEasingClosed(note)) easeBackOpen(note, drawNote);
  else drawNote();
  followHandoff();
}

// On System, the icon re-adding gives follows the phone's setting. A change that comes as the page
// comes back takes the note to its new state at once, in the same frame as the theme, to match the
// app the phone has just shown in its new look. Any other eases the note in a task of its own, as
// for a pick, since Safari reports it in the middle of drawing a frame, which an easing started
// then misses, showing the note at its end for that frame.
function followPhoneLook() {
  const change = { isHidden: document.hidden, changedAt: performance.now(), shownAt };
  if (isLookChangeOnReturn(change)) drawNoteAtOnce();
  else setTimeout(updateNote);
}

function dismissNote() {
  keepReAddNoteDismissed();
  updateNote();
}

function wireNote() {
  const settings = findSettings();
  updateNote();
  // Settings opening asks for a handoff, and closing lets go of it, before the dialog's close
  // event, which then draws the link waiting for a fresh one.
  new MutationObserver(followHandoff).observe(settings, {
    attributes: true,
    attributeFilter: ["open"],
  });
  settings.addEventListener("close", drawNote);
  findNote().addEventListener("click", (event) => {
    if (/** @type {Element} */ (event.target).closest("#dismissReAddNote")) dismissNote();
  });
  watchTimeAway(renewIfDue);
}

/**
 * Wires the settings' Appearance choices, and the welcome's copy of them
 * (draw-home-screen-asks.js), to the look they pick, and the note on bringing a Home Screen app's
 * icon up to date.
 * @param {Looks} looks
 */
export function startAppearance(looks) {
  checkSavedChoice(findAppearanceChoices());
  const showChosenTheme = followTheme(looks, appearance.read);
  // The welcome draws its steps again as a move finishes (draw-home-screen-asks.js), so the page
  // follows its choices wherever they are now, after the welcome keeps an icon picked for a move.
  document.addEventListener("change", (event) => {
    const choice = /** @type {HTMLInputElement} */ (event.target);
    if (choice.name === "welcomeIcon") showChosenTheme();
    if (!choice.matches(APPEARANCE_CHOICES)) return;
    if (isIosApp()) keepLookSwitched();
    appearance.keep(choice.value);
    openThemeAddress(choice.value);
    checkSavedChoice(findAppearanceChoices());
    showChosenTheme();
    updateNote();
  });
  // Closing the welcome finishes a move, and the icon picked for it goes with it.
  findElement("homeScreenWelcome").addEventListener("close", showChosenTheme);
  appearance.watch(() => {
    openThemeAddress(appearance.read());
    checkSavedChoice(findAppearanceChoices());
    showChosenTheme();
    updateNote();
  });
  watchTimeAway(keepReturnTime);
  darkScheme.addEventListener("change", followPhoneLook);
  wireNote();
}
