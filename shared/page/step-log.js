// While Diagnostics is on, a step log keeps what one part of the page does, with each touch and
// click on it. The last few lines stay on this device, for Diagnostics to list: the page holds
// them as it logs, since a touch or click can come many times a second, and keeps them on the
// device a moment after a line comes, with every line that comes meanwhile, so a burst writes
// once and a page that crashes, even mid-fling, still has them, and as it leaves the screen.

import { hideAddresses } from "./report-addresses.js";
import { formatClockTimeWithSeconds } from "./days.js";
import { forgetStored, readStoredJson, storeJson } from "./local-storage.js";

// Enough for a fling through a few weeks of a season's list, each day it passes a line.
const KEPT_LINES = 200;
const SAVE_AFTER_MS = 1000;

/** @typedef {{ at: number, text: string }} StepLine */
/** @typedef {StepLine & { id: string }} LoggedLine */

/**
 * Two tabs' lines as one log, each line once, oldest first, and only the last few.
 * @param {LoggedLine[]} kept
 * @param {LoggedLine[]} held
 */
function mergeLines(kept, held) {
  const byId = new Map([...kept, ...held].map((line) => [line.id, line]));
  return [...byId.values()].toSorted((first, second) => first.at - second.at).slice(-KEPT_LINES);
}

/**
 * A line as storage kept it, its addresses hidden, named by when it came and what it says when
 * storage names it by nothing else.
 * @param {any} line
 * @returns {LoggedLine}
 */
function readKeptLine(line) {
  const text = hideAddresses(String(line.text));
  return { id: String(line.id ?? `${line.at} ${text}`), at: line.at, text };
}

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
 * Every text a node holds, each part apart, since parts that sit side by side on the screen, like
 * a seed beside a name, are often written with nothing between them.
 * @param {Node} node
 * @returns {string}
 */
const readTextParts = (node) =>
  node.nodeType === Node.TEXT_NODE
    ? (node.nodeValue ?? "")
    : [...node.childNodes].map(readTextParts).join(" ");

/**
 * A control's words as one line of the report, a comma kept on the word before it.
 * @param {Element} control
 */
const readControlWords = (control) =>
  readTextParts(control).replace(/\s+/g, " ").replaceAll(" ,", ",").trim();

/**
 * Whether a control is an email link, whose words are an address, so a report never names it by
 * them.
 * @param {Element} control
 */
const isEmailLink = (control) => !!control.getAttribute("href")?.startsWith("mailto:");

/**
 * What a touch or click landed on: the button or link it's in, by name, or else the element.
 * @param {Element} target
 * @returns {string}
 */
export function describeTarget(target) {
  const control = target.closest("button, a");
  const name =
    control &&
    !isEmailLink(control) &&
    (control.getAttribute("aria-label") || readControlWords(control));
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
  /** @type {LoggedLine[] | null} */
  let held = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let saveTimer;
  // Each line is named by the tab's log that logged it and its count there, so two tabs' saves
  // keep each line once, even two that say the same at the same moment. The id is made with the
  // first line, since a Worker that imports a log may not make random values as it loads.
  /** @type {string | undefined} */
  let logId;
  let linesLogged = 0;

  /** @returns {LoggedLine[]} */
  function loadLines() {
    const kept = readStoredJson(key);
    return Array.isArray(kept) ? kept.map(readKeptLine) : [];
  }

  const holdLines = () => (held ??= loadLines());

  function stopSaveTimer() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }

  /** @returns {StepLine[]} oldest first */
  const readLines = () => [...holdLines()];

  // Every tab holds its own lines, so a save keeps the lines other tabs saved too. A log turned
  // off, here or in another tab, has forgotten its lines, so they never go back. Lines storage
  // won't take are lost once the page goes.
  function saveLines() {
    stopSaveTimer();
    if (!held || !isOn()) return;
    held = mergeLines(loadLines(), held);
    storeJson(key, held);
  }

  // Another tab forgot the log, or storage was cleared.
  /** @param {StorageEvent} event */
  function dropForgottenLines(event) {
    if (event.key === null || (event.key === key && event.newValue === null)) {
      stopSaveTimer();
      held = [];
    }
  }

  function forgetLines() {
    stopSaveTimer();
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
    logId ??= crypto.randomUUID();
    linesLogged += 1;
    lines.push({ id: `${logId}-${linesLogged}`, at: Date.now(), text: hideAddresses(text) });
    lines.splice(0, lines.length - KEPT_LINES);
    saveTimer ??= setTimeout(saveLines, SAVE_AFTER_MS);
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
