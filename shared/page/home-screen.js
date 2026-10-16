// The page's asks to be added to the Home Screen, which draw-home-screen-asks.js draws before the
// first paint: the welcome a phone's or tablet's browser opens on, and the box at the bottom of
// settings. Neither shows on a computer, or once the page is opened from the Home Screen. Going on
// in the browser closes the welcome on this device for good, and the box stays, so the steps are
// still there. With Chrome's own install to hand, Install takes the place of the steps in both.
// The welcome's first step picks the theme, which appearance.js keeps.

import { isOnHomeScreen, isTouchDevice } from "./device.js";

/**
 * Chrome's own install dialog, which it offers only to a page it can install.
 * @typedef {Event & {
 *   prompt: () => Promise<void>,
 *   userChoice: Promise<{ outcome: "accepted" | "dismissed" }>,
 * }} InstallPrompt
 */

// draw-home-screen-asks.js reads it under the same key before the first paint.
const WELCOME_CLOSED_KEY = "homeScreenWelcomeClosed";

/** @type {InstallPrompt | null} */
let installPrompt = null;
let isInstalled = false;

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const findWelcome = () => /** @type {HTMLDialogElement} */ (findElement("homeScreenWelcome"));

function saveWelcomeClosed() {
  try {
    localStorage.setItem(WELCOME_CLOSED_KEY, "closed");
  } catch {
    /* the welcome opens again on the next visit */
  }
}

const isAsking = () => isTouchDevice() && !isOnHomeScreen() && !isInstalled;

// Each ask shows Chrome's Install while it's to hand, and the browser's own steps otherwise.
/** @param {HTMLElement} part */
const isPartShown = (part) => (part.dataset.ask === "install") === !!installPrompt;

function showAsks() {
  findElement("homeScreenTip").hidden = !isAsking();
  const parts = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-ask]"));
  for (const part of parts) part.hidden = !isPartShown(part);
  if (!isAsking() && findWelcome().open) findWelcome().close();
}

// Chrome's dialog can be shown only once, so the steps come back if it's turned down or fails.
async function install() {
  const prompt = installPrompt;
  installPrompt = null;
  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") isInstalled = true;
  } catch {
    /* the steps take its place */
  }
  showAsks();
}

/** @param {Event} event */
function followClick(event) {
  const target = /** @type {Element} */ (event.target);
  if (target.closest("[data-install]") && installPrompt) install();
  else if (target.closest(".welcome-continue")) findWelcome().close();
}

/** @param {Event} event */
function keepInstallPrompt(event) {
  event.preventDefault();
  installPrompt = /** @type {InstallPrompt} */ (event);
  showAsks();
}

function forgetAsks() {
  isInstalled = true;
  installPrompt = null;
  showAsks();
}

export function startHomeScreen() {
  findElement("homeScreenTip").addEventListener("click", followClick);
  findWelcome().addEventListener("click", followClick);
  // Escape and Continue in the browser both close it, and either way it stays closed.
  findWelcome().addEventListener("close", saveWelcomeClosed);
  // Chrome would otherwise show its own banner along the bottom of the screen.
  window.addEventListener("beforeinstallprompt", keepInstallPrompt);
  window.addEventListener("appinstalled", forgetAsks);
  showAsks();
}
