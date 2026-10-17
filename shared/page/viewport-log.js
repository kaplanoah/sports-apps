// While Diagnostics is on, the page logs each change to the screen's viewports as the viewer
// scrolls and turns the phone: the screen, the layout viewport that the tab bar and sheets are held
// to, the visual viewport the viewer sees, and where the tab bar and an open sheet end. A visual
// viewport out of line with the layout one is flagged, since then whatever is held to the bottom of
// the screen shows away from it. The page's opening, each time it leaves the screen, and each time
// it comes back are logged whether or not anything changed, and a bounce past either end of the
// page isn't logged at all. The last few changes stay on this device, for Diagnostics to list,
// with the latest line where the viewport went off even once newer lines have pushed it out.

import { formatClockTimeWithSeconds } from "./days.js";
import { forgetStored, readStoredJson, storeJson } from "./local-storage.js";

const LINES_KEY = "diagnosticsViewport";
const KEPT_LINES = 40;

/**
 * @typedef {{
 *   screen: number,
 *   layout: number,
 *   visualHeight: number,
 *   visualTop: number,
 *   scroll: number,
 *   page: number,
 *   tabBarBottom: number | null,
 *   sheetBottom: number | null,
 * }} ViewportReading
 */
/** @typedef {{ at: number, text: string, isOff: boolean, wentOff?: boolean }} ViewportLine */
/** @typedef {"Opened" | "Left" | "Back"} ViewportMoment */

let lastShape = "";
let isReadingQueued = false;

/** @returns {ViewportLine[]} */
export function readViewportLines() {
  const lines = readStoredJson(LINES_KEY);
  return Array.isArray(lines) ? lines : [];
}

/**
 * The newest lines, and before them the latest line where the viewport went off, if it's older.
 * @param {ViewportLine[]} lines oldest first
 * @returns {ViewportLine[]}
 */
export function trimViewportLines(lines) {
  if (lines.length <= KEPT_LINES) return lines;
  const newest = lines.slice(-KEPT_LINES);
  const latestWentOff = lines.findLast((line) => line.wentOff);
  return latestWentOff && !newest.includes(latestWentOff) ? [latestWentOff, ...newest] : newest;
}

// A line storage won't take is lost, and the next change tries again.
/** @param {ViewportLine[]} lines */
const saveViewportLines = (lines) => storeJson(LINES_KEY, trimViewportLines(lines));

export function forgetViewportLines() {
  lastShape = "";
  forgetStored(LINES_KEY);
}

/** @param {Element | null} element */
const readBottom = (element) =>
  element ? Math.round(element.getBoundingClientRect().bottom) : null;

/** @returns {ViewportReading} */
function readViewport() {
  const openDialogs = document.querySelectorAll("dialog[open]");
  return {
    screen: screen.height,
    layout: innerHeight,
    visualHeight: Math.round(visualViewport?.height ?? innerHeight),
    visualTop: Math.round(visualViewport?.offsetTop ?? 0),
    scroll: Math.round(scrollY),
    page: document.documentElement.scrollHeight,
    tabBarBottom: readBottom(document.getElementById("tabBar")),
    sheetBottom: readBottom(openDialogs[openDialogs.length - 1] ?? null),
  };
}

/**
 * Everything in a reading but how far the page is scrolled, which changes with every scroll.
 * @param {ViewportReading} reading
 * @returns {string}
 */
export function describeViewportShape(reading) {
  const ends = [
    reading.tabBarBottom !== null && `tab bar ends ${reading.tabBarBottom}`,
    reading.sheetBottom !== null && `sheet ends ${reading.sheetBottom}`,
  ].filter(Boolean);
  return [
    `screen ${reading.screen}`,
    `layout ${reading.layout}`,
    `visual ${reading.visualHeight} from ${reading.visualTop}`,
    `page ${reading.page}`,
    ...ends,
  ].join(", ");
}

/**
 * @param {ViewportReading} reading
 * @param {ViewportMoment | null} [moment]
 * @returns {string}
 */
export function describeViewport(reading, moment = null) {
  const text = `${describeViewportShape(reading)}, scrolled ${reading.scroll}`;
  return moment ? `${moment}: ${text}` : text;
}

/**
 * Whether the page is bouncing past its top or bottom, which moves the visual viewport and the
 * tab bar with it on every frame of the bounce.
 * @param {ViewportReading} reading
 * @returns {boolean}
 */
export const isBouncing = (reading) =>
  reading.scroll < 0 || reading.scroll > reading.page - reading.layout;

/**
 * @param {ViewportReading} reading
 * @returns {boolean}
 */
export const isViewportOff = (reading) =>
  reading.visualTop !== 0 || reading.visualHeight !== reading.layout;

/**
 * @param {ViewportLine[]} lines newest first
 * @returns {string}
 */
export const writeViewportAsText = (lines) =>
  lines.length
    ? [
        "Viewport",
        ...lines.map(
          (line) =>
            `${formatClockTimeWithSeconds(new Date(line.at))} ${line.text}${line.isOff ? " (off)" : ""}`,
        ),
      ].join("\n")
    : "";

/**
 * @param {ViewportReading} reading
 * @param {ViewportMoment | null} moment
 * @param {ViewportLine | undefined} lastLine
 * @returns {ViewportLine}
 */
function writeViewportLine(reading, moment, lastLine) {
  const isOff = isViewportOff(reading);
  const line = { at: Date.now(), text: describeViewport(reading, moment), isOff };
  return isOff && !lastLine?.isOff ? { ...line, wentOff: true } : line;
}

/**
 * Logs the viewport as it is now, at a moment, or else only once its shape has changed.
 * @param {ViewportMoment | null} moment
 * @param {() => void} onLogged
 */
function logViewport(moment, onLogged) {
  const reading = readViewport();
  const shape = describeViewportShape(reading);
  if (!moment && (shape === lastShape || isBouncing(reading))) return;
  lastShape = shape;
  const lines = readViewportLines();
  saveViewportLines([...lines, writeViewportLine(reading, moment, lines.at(-1))]);
  onLogged();
}

/**
 * Logs the viewport as the page opens, leaves the screen, and comes back, and on each change to
 * it, at most once a frame, while isOn() says to.
 * @param {() => boolean} isOn
 * @param {() => void} onLogged
 */
export function watchViewport(isOn, onLogged) {
  const queueReading = () => {
    if (isReadingQueued || !isOn()) return;
    isReadingQueued = true;
    requestAnimationFrame(() => {
      isReadingQueued = false;
      logViewport(null, onLogged);
    });
  };
  const logVisibility = () => {
    if (isOn()) logViewport(document.hidden ? "Left" : "Back", onLogged);
  };
  addEventListener("scroll", queueReading, { passive: true });
  visualViewport?.addEventListener("scroll", queueReading);
  visualViewport?.addEventListener("resize", queueReading);
  document.addEventListener("toggle", queueReading, true);
  document.addEventListener("visibilitychange", logVisibility);
  if (isOn()) logViewport("Opened", onLogged);
}
