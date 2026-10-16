// While Diagnostics is on, a step log keeps what one part of the page does, with each touch and
// click on it. The last few lines stay on this device, for Diagnostics to list: the page holds
// them as it logs, since a touch or click can come many times a second, and keeps them on the
// device a moment after the last one, so a burst writes once and a page that crashes still has
// them, and as it leaves the screen.

import { formatClockTimeWithSeconds } from "./days.js";
import { forgetStored, readStoredJson, storeJson } from "./local-storage.js";

// Enough for a fling through a few weeks of a season's list, each day it passes a line.
const KEPT_LINES = 200;
const SAVE_AFTER_MS = 1000;

/** @typedef {{ at: number, text: string }} StepLine */

/**
 * Two tabs' lines as one log, each line once, oldest first, and only the last few.
 * @param {StepLine[]} kept
 * @param {StepLine[]} held
 */
function mergeLines(kept, held) {
  const byStep = new Map([...kept, ...held].map((line) => [`${line.at} ${line.text}`, line]));
  return [...byStep.values()].toSorted((first, second) => first.at - second.at).slice(-KEPT_LINES);
}

/**
 * A file by its own name, and the page by "page", never by an address, whose path holds the page's
 * key, so a report shared from Diagnostics can't open the page.
 * @param {string} url
 */
export function nameFile(url) {
  const name = readLastPathPart(url);
  return name.includes(".") ? name : "page";
}

/**
 * The last part of an address's path, or nothing for text that isn't an address. It catches what
 * `URL.canParse` would test, which iOS 16 lacks.
 * @param {string} url
 */
function readLastPathPart(url) {
  try {
    return new URL(url).pathname.split("/").at(-1) ?? "";
  } catch {
    return "";
  }
}

/**
 * Text with each address in it, a socket's too, named as nameFile names it.
 * @param {string} text
 */
export const hideAddresses = (text) => text.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/g, nameFile);

/**
 * A log's lines as text under its title, or nothing when it has none.
 * @param {string} title
 * @param {StepLine[]} lines newest first
 * @returns {string}
 */
export const writeStepsAsText = (title, lines) =>
  lines.length
    ? [
        title,
        ...lines.map((line) => `${formatClockTimeWithSeconds(new Date(line.at))} ${line.text}`),
      ].join("\n")
    : "";

/**
 * What a touch or click landed on: the button or link it's in, by name, or else the element.
 * @param {Element} target
 * @returns {string}
 */
function describeTarget(target) {
  const control = target.closest("button, a");
  const name = control?.getAttribute("aria-label") || control?.textContent?.trim();
  if (name) return name;
  if (target.id) return `#${target.id}`;
  return [target.localName, ...target.classList].join(".");
}

/**
 * @param {Event} event
 * @returns {{ clientX: number, clientY: number } | null}
 */
function findPoint(event) {
  const { changedTouches } = /** @type {Partial<TouchEvent>} */ (event);
  if (changedTouches) return changedTouches[0] ?? null;
  return /** @type {MouseEvent} */ (event);
}

/**
 * @param {Event} event
 * @returns {string}
 */
function describeTouchOrClick(event) {
  const point = findPoint(event);
  const where = point ? ` at ${Math.round(point.clientX)},${Math.round(point.clientY)}` : "";
  return `${event.type}${where} on ${describeTarget(/** @type {Element} */ (event.target))}`;
}

/**
 * A log of one part of the page, under `title` in Diagnostics, kept under `key`.
 * @param {{ key: string, title: string, isWatched: (target: Element) => boolean }} log
 *   `isWatched` says whether a touch or click on `target` is the part's
 */
export function createStepLog({ key, title, isWatched }) {
  let isOn = () => false;
  let onLogged = () => {};
  /** @type {StepLine[] | null} */
  let held = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let saveTimer;

  /** @returns {StepLine[]} */
  function loadLines() {
    const kept = readStoredJson(key);
    return Array.isArray(kept)
      ? kept.map((line) => ({ ...line, text: hideAddresses(String(line.text)) }))
      : [];
  }

  const holdLines = () => (held ??= loadLines());

  /** @returns {StepLine[]} oldest first */
  const readLines = () => [...holdLines()];

  // Every tab holds its own lines, so a save keeps the lines other tabs saved too. A log turned
  // off, here or in another tab, has forgotten its lines, so they never go back. Lines storage
  // won't take are lost once the page goes.
  function saveLines() {
    clearTimeout(saveTimer);
    if (!held || !isOn()) return;
    held = mergeLines(loadLines(), held);
    storeJson(key, held);
  }

  // Another tab forgot the log, or storage was cleared.
  /** @param {StorageEvent} event */
  function dropForgottenLines(event) {
    if (event.key === null || (event.key === key && event.newValue === null)) {
      clearTimeout(saveTimer);
      held = [];
    }
  }

  function forgetLines() {
    clearTimeout(saveTimer);
    held = [];
    forgetStored(key);
  }

  /**
   * Logs a step while Diagnostics is on.
   * @param {string} text
   */
  function noteStep(text) {
    if (!isOn()) return;
    const lines = holdLines();
    lines.push({ at: Date.now(), text: hideAddresses(text) });
    lines.splice(0, lines.length - KEPT_LINES);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveLines, SAVE_AFTER_MS);
    onLogged();
  }

  /**
   * @param {StepLine[]} lines newest first
   * @returns {string}
   */
  const writeLinesAsText = (lines) => writeStepsAsText(title, lines);

  /** @param {Event} event */
  function noteTouchOrClick(event) {
    if (event.target instanceof Element && isWatched(event.target))
      noteStep(describeTouchOrClick(event));
  }

  /**
   * Logs the part's steps, and each touch and click on it, while isLogging() says to.
   * @param {() => boolean} isLogging
   * @param {() => void} onLineLogged
   */
  function watchSteps(isLogging, onLineLogged) {
    isOn = isLogging;
    onLogged = onLineLogged;
    for (const type of ["touchstart", "touchend", "click"])
      document.addEventListener(type, noteTouchOrClick, { capture: true, passive: true });
    document.addEventListener("visibilitychange", () => document.hidden && saveLines());
    addEventListener("pagehide", saveLines);
    addEventListener("storage", dropForgottenLines);
  }

  return {
    title,
    noteStep,
    isLogging: () => isOn(),
    readLines,
    forgetLines,
    writeLinesAsText,
    watchSteps,
  };
}

/** @typedef {ReturnType<typeof createStepLog>} StepLog */
