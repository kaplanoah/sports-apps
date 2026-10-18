// The page's asks to be added to the Home Screen, which draw-home-screen-asks.js draws before the
// first paint, and whose welcome keeps its own theme pick and closing: the welcome a phone's or
// tablet's browser opens on, and the box at the top of settings. Neither shows on a computer, or
// once the page is opened from the Home Screen. With Chrome's own install to hand, Install takes
// the place of the steps in both. The welcome opens again from settings' Notifications, rising
// as settings does, and closes as settings does, sliding down from its caret, Escape, Android's
// back, or a swipe down.

/* global forgetWelcomeClosed -- from pick-theme.js */

import { isOnHomeScreen, isTouchDevice } from "./device.js";
import { closeOnCancel, closeOnSwipeDown } from "./sheet-swipe.js";

/**
 * Chrome's own install dialog, which it offers only to a page it can install.
 * @typedef {Event & {
 *   prompt: () => Promise<void>,
 *   userChoice: Promise<{ outcome: "accepted" | "dismissed" }>,
 * }} InstallPrompt
 */

/** @type {InstallPrompt | null} */
let installPrompt = null;
let isInstalled = false;

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const findWelcome = () => /** @type {HTMLDialogElement} */ (findElement("homeScreenWelcome"));

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

/**
 * Opens the welcome over the page, rising as a sheet does, and keeps it open through the reload a
 * theme picked on it brings in Safari.
 */
export function openWelcome() {
  forgetWelcomeClosed();
  findWelcome().showModal();
}

function wireWelcomeClosing() {
  const welcome = findWelcome();
  closeOnCancel(welcome);
  closeOnSwipeDown(welcome, { isOwnGesture: () => false, findScroller: () => welcome });
}

export function startHomeScreen() {
  findElement("homeScreenTip").addEventListener("click", followClick);
  findWelcome().addEventListener("click", followClick);
  wireWelcomeClosing();
  // Chrome would otherwise show its own banner along the bottom of the screen.
  window.addEventListener("beforeinstallprompt", keepInstallPrompt);
  window.addEventListener("appinstalled", forgetAsks);
  showAsks();
}
