// What a sheet shows where a read of its Worker failed, as retry.css draws it: a whole sheet or
// section that didn't load holds a centered block saying why and what comes next, and one part of
// it a note in that part's place. A tap on Try again, the phone coming back online, or the page
// coming back reads again, so the part shows its placeholders until the read answers.

import { html } from "./html.js";
import { watchTimeAway } from "./resume.js";

// Phosphor's arrow-clockwise, at its Regular weight.
const ARROW = html`<svg class="retry-icon" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1,0-16H211.4L184.81,71.64l-.25-.24a80,80,0,1,0-1.67,114.78,8,8,0,0,1,11,11.63A95.44,95.44,0,0,1,128,224h-1.32A96,96,0,1,1,195.75,60L224,85.8V56a8,8,0,1,1,16,0Z"
  />
</svg>`;

// Phosphor's cell-signal-slash, at its Light weight.
const CELL_SIGNAL_SLASH = html`<svg class="retry-art" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M86,152v48a6,6,0,0,1-12,0V152a6,6,0,0,1,12,0ZM40,186a6,6,0,0,0-6,6v8a6,6,0,0,0,12,0v-8A6,6,0,0,0,40,186Zm172.44,26L52.44,36A6,6,0,0,0,43.56,44L114,121.52V200a6,6,0,0,0,12,0V134.72l28,30.8V200a6,6,0,0,0,12,0V178.72L203.56,220a6,6,0,0,0,8.88-8.08ZM160,121.63a6,6,0,0,0,6-6V72a6,6,0,0,0-12,0v43.63A6,6,0,0,0,160,121.63Zm40,44a6,6,0,0,0,6-6V32a6,6,0,0,0-12,0V159.63A6,6,0,0,0,200,165.63Z"
  />
</svg>`;

// Phosphor's plugs, at its Light weight.
const PLUGS = html`<svg class="retry-art" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M148.24,139.76a6,6,0,0,0-8.48,0L120,159.51,96.49,136l19.75-19.76a6,6,0,0,0-8.48-8.48L88,127.51,68.24,107.76a6,6,0,0,0-8.48,8.48L67.51,124,42.79,148.73a30,30,0,0,0,0,42.42l6.78,6.79L19.76,227.76a6,6,0,1,0,8.48,8.48l29.82-29.81,6.79,6.78a30,30,0,0,0,42.42,0L132,188.49l7.76,7.75a6,6,0,0,0,8.48-8.48L128.49,168l19.75-19.76A6,6,0,0,0,148.24,139.76Zm-49.45,65a18,18,0,0,1-25.46,0L51.27,182.67a18,18,0,0,1,0-25.46L76,132.49,123.51,180Zm137.45-185a6,6,0,0,0-8.48,0L197.94,49.57l-6.79-6.78a30,30,0,0,0-42.42,0L124,67.51l-7.76-7.75a6,6,0,0,0-8.48,8.48l80,80a6,6,0,0,0,8.48-8.48L188.49,132l24.72-24.73a30,30,0,0,0,0-42.42l-6.78-6.79,29.81-29.82A6,6,0,0,0,236.24,19.76Zm-31.51,79L180,123.51,132.49,76l24.72-24.73a18,18,0,0,1,25.46,0l22.06,22.06a18,18,0,0,1,0,25.46Z"
  />
</svg>`;

// Phosphor's warning-circle, at its Regular weight, as in a line of text.
const WARNING = html`<svg class="retry-warning" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z"
  />
</svg>`;

/** @param {{ isFilled?: boolean }} [options] the one in a centered block is filled */
export const renderRetryButton = ({ isFilled = false } = {}) =>
  html`<button type="button" class="retry-button${isFilled ? " filled" : ""}" data-retry>
    ${ARROW}<span>Try again</span>
  </button>`;

/**
 * Why something didn't load, after a warning icon.
 * @param {string} message
 * @param {string} [className] the class of the text it stands in for, so it keeps that text's type
 */
export const renderRetryMessage = (message, className) =>
  html`<p class="${["retry-message", className].filter(Boolean).join(" ")}">${WARNING}<span>${message}</span></p>`;

/** @typedef {"offline" | "unreachable" | "server" | "unavailable"} ReadFailure */

/**
 * Why a read of the Worker failed: the phone is offline, the server is out of reach, or the server
 * answered with a problem, as a failure carrying the answer's status says.
 * @param {unknown} error
 * @returns {ReadFailure}
 */
export function classifyReadFailure(error) {
  if (navigator.onLine === false) return "offline";
  if (/** @type {any} */ (error)?.code === "not_available_yet") return "unavailable";
  return typeof (/** @type {any} */ (error)?.status) === "number" ? "server" : "unreachable";
}

// A read that failed offline reads again as the phone comes back online; any other waits for a tap.
/** @type {Record<ReadFailure, { icon: import("./html.js").Markup, title: string, next: (subject: string) => string }>} */
const FAILURES = {
  unavailable: {
    icon: PLUGS,
    title: "Not available yet",
    next: () => "We're still adding this past season's details",
  },
  offline: {
    icon: CELL_SIGNAL_SLASH,
    title: "Couldn't connect to the internet",
    next: (subject) => `Will load ${subject} when back online`,
  },
  unreachable: {
    icon: PLUGS,
    title: "Couldn't connect to the server",
    next: (subject) => `Try again to load ${subject}`,
  },
  server: {
    icon: PLUGS,
    title: "The server had a problem",
    next: (subject) => `Try again to load ${subject}`,
  },
};

/**
 * In place of a whole sheet or section that didn't load: an icon and why, what comes next, and a
 * filled button, centered.
 * @param {string} subject what didn't load, as the line under why names it, like "roster"
 * @param {ReadFailure} failure
 */
export function renderRetryBlock(subject, failure) {
  const { icon, title, next } = FAILURES[failure];
  return html`<div class="retry-block">
    ${icon}
    <p class="retry-title">${title}</p>
    <p class="retry-next">${next(subject)}</p>
    ${renderRetryButton({ isFilled: true })}
  </div>`;
}

/**
 * In place of one part that didn't load: why, with the button under it.
 * @param {string} message
 * @param {string} [className] the class of the text it stands in for
 */
export const renderRetryNote = (message, className) =>
  html`<div class="retry-note">${renderRetryMessage(message, className)}${renderRetryButton()}</div>`;

/**
 * Calls `retry` on a tap on a Try again button inside `holder`, and, while `holder` shows one, as
 * the phone comes back online or the page comes back.
 * @param {HTMLElement} holder
 * @param {() => void} retry
 */
export function watchRetries(holder, retry) {
  holder.addEventListener("click", (event) => {
    const button = /** @type {Element} */ (event.target).closest("[data-retry]");
    if (button) retry();
  });
  const retryIfShown = () => {
    if (holder.querySelector("[data-retry]")) retry();
  };
  addEventListener("online", retryIfShown);
  watchTimeAway(retryIfShown);
}
