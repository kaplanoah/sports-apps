// While Diagnostics is on, a step log keeps what one part of the page does, with each touch and
// click on it. The last few lines stay on this device, for Diagnostics to list.

import { formatClockTimeWithSeconds } from "./days.js";

// Enough for a fling through a few weeks of a season's list, each day it passes a line.
const KEPT_LINES = 200;

/** @typedef {{ at: number, text: string }} StepLine */

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

  /** @returns {StepLine[]} */
  function readLines() {
    try {
      const lines = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(lines) ? lines : [];
    } catch {
      return [];
    }
  }

  /** @param {StepLine[]} lines */
  function saveLines(lines) {
    try {
      localStorage.setItem(key, JSON.stringify(lines.slice(-KEPT_LINES)));
    } catch {
      /* the line is lost, and the next step tries again */
    }
  }

  function forgetLines() {
    try {
      localStorage.removeItem(key);
    } catch {
      /* the lines stay until the next try */
    }
  }

  /**
   * Logs a step while Diagnostics is on.
   * @param {string} text
   */
  function noteStep(text) {
    if (!isOn()) return;
    saveLines([...readLines(), { at: Date.now(), text }]);
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
