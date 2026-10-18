// The box under the tabs that lists what's new since the viewer first opened the app or last
// dismissed the box, newest first, each beside when it happened, and under them, what's new in the
// app. An app says what its updates and release notes are and where the box's start is kept.

import {
  countDaysBetween,
  formatClockTime,
  formatShortDate,
  formatWeekday,
  nameDay,
} from "./days.js";
import { createViewerChoice } from "./device-storage.js";
import { easeClosed, stopEasing } from "./eased-redraw.js";
import { html, noteHeight, setHtml } from "./html.js";

// Phosphor's x, at its Light weight, like the page's other close buttons.
const DISMISS_ICON = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z"
  />
</svg>`;

/** @typedef {import("./html.js").Markup} Markup */
/**
 * When it happened, the day it happened on, where a game that ran past midnight sets it apart
 * from its time's, whether its game ended on a later day than it started, what it says, and for
 * an update about one game, the button that opens the game, as its row in the Games view does.
 * @typedef {{ at: number, day?: Date | null, endedNextDay?: boolean, text: Markup, action?: Markup | false }} Update
 */
/**
 * When it went out, as an ISO time, and what it says, with any word that should stand out, like a
 * button's name, in <b>, which an app sets a step heavier than its text.
 * @typedef {{ at: string, text: string | Markup }} ReleaseNote
 */
/** @typedef {{ at: number, text: string | Markup }} Note a release note to show */
/** @typedef {Record<string, number>} NoteClocks when each release note stops showing, by its `at` */

const MAX_SHOWN = 12;
const MAX_NOTES_SHOWN = 3;
const NOTE_SHOWN_MS = 14 * 24 * 60 * 60 * 1000;

/** @param {Update} update */
const readHappenedDay = (update) => update.day ?? new Date(update.at);

/**
 * The night a game that ran past midnight was played, as people say it.
 * @param {Date} day
 * @param {Date} today
 */
function nameNight(day, today) {
  const daysAway = countDaysBetween(today, day);
  if (daysAway === -1) return "Last night";
  return Math.abs(daysAway) < 7 ? `${formatWeekday(day)} night` : formatShortDate(day);
}

/**
 * @param {Update} update
 * @param {Date} today
 */
function formatWhen(update, today) {
  const day = readHappenedDay(update);
  if (Number.isNaN(day.getTime())) return "";
  if (countDaysBetween(day, today) <= 0) return formatClockTime(new Date(update.at));
  if (update.endedNextDay) return nameNight(day, today);
  return nameDay(day, today, { isCapitalized: true });
}

/**
 * @param {Update} update
 * @param {Date} today
 */
function formatSince(update, today) {
  const day = readHappenedDay(update);
  if (Number.isNaN(day.getTime())) return "";
  if (countDaysBetween(day, today) <= 0) return "since earlier today";
  return `since ${nameDay(day, today)}`;
}

// Updates that share a time show it once, on the first of them.
/**
 * @param {Update[]} updates
 * @param {Date} today
 */
function formatTimeColumn(updates, today) {
  const times = updates.map((update) => formatWhen(update, today));
  return times.map((time, index) => (time === times[index - 1] ? "" : time));
}

/**
 * @param {ReleaseNote} note
 * @param {number} now
 */
const isOut = (note, now) => Date.parse(note.at) <= now;

// A note shows for two weeks from when this device first showed it, so a viewer back from time
// away still sees it.
/**
 * @param {ReleaseNote} note
 * @param {NoteClocks} clocks
 * @param {number} now
 */
const readShownUntil = (note, clocks, now) => clocks[note.at] ?? now + NOTE_SHOWN_MS;

/**
 * @param {ReleaseNote[]} notes
 * @param {number} now
 * @param {(note: ReleaseNote) => number} readUntil
 * @returns {NoteClocks}
 */
const mapOutNotes = (notes, now, readUntil) =>
  Object.fromEntries(
    notes.filter((note) => isOut(note, now)).map((note) => [note.at, readUntil(note)]),
  );

/**
 * When each note out by now stops showing, starting the two weeks of any this device hasn't shown.
 * @param {ReleaseNote[]} notes
 * @param {NoteClocks} clocks
 * @param {number} now
 */
export const startNoteClocks = (notes, clocks, now) =>
  mapOutNotes(notes, now, (note) => readShownUntil(note, clocks, now));

/**
 * The clocks after a dismissal, which ends every note's showing.
 * @param {ReleaseNote[]} notes
 * @param {NoteClocks} clocks
 * @param {number} now
 */
export const endNoteClocks = (notes, clocks, now) =>
  mapOutNotes(notes, now, (note) => Math.min(readShownUntil(note, clocks, now), now));

/**
 * The release notes still to show, in the order the app lists them.
 * @param {ReleaseNote[]} notes
 * @param {NoteClocks} clocks
 * @param {number} now
 * @returns {Note[]}
 */
export const listFreshNotes = (notes, clocks, now) =>
  notes
    .filter((note) => isOut(note, now) && readShownUntil(note, clocks, now) > now)
    .map((note) => ({ at: Date.parse(note.at), text: note.text }));

/**
 * @param {unknown} stored
 * @returns {NoteClocks | null}
 */
function readNoteClocks(stored) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  return Object.fromEntries(
    Object.entries(stored).filter(([, until]) => typeof until === "number"),
  );
}

const noteClocks = createViewerChoice("releaseNotesShownUntil", readNoteClocks);

/**
 * @param {ReleaseNote[]} notes
 * @param {NoteClocks} clocks
 * @param {number} now
 */
const hasUnstartedNote = (notes, clocks, now) =>
  notes.some((note) => isOut(note, now) && !(note.at in clocks));

// A viewer new to the app has nothing to catch up on, so a device's first look counts every note
// already out as shown.
/**
 * The release notes this device still shows, starting the two weeks of any it shows for the first
 * time.
 * @param {ReleaseNote[]} notes newest first
 * @param {number} [now]
 */
export function listNotesToShow(notes, now = Date.now()) {
  const kept = noteClocks.read();
  const clocks = startNoteClocks(notes, kept ?? endNoteClocks(notes, {}, now), now);
  if (!kept || hasUnstartedNote(notes, kept, now)) noteClocks.keep(clocks);
  return listFreshNotes(notes, clocks, now);
}

/**
 * @param {ReleaseNote[]} notes
 * @param {number} [now]
 */
export const dismissNotes = (notes, now = Date.now()) =>
  noteClocks.keep(endNoteClocks(notes, noteClocks.read() ?? {}, now));

// A viewer new to the app has nothing to catch up on, so a device's first look starts the box after
// every update already out, and keeps that start, so nothing that comes later is skipped. A page
// that hasn't read its season yet can't tell what's out, so it keeps nothing and lists nothing.
/**
 * When the box's updates count from: what this device kept, or, on its first look, the newest
 * update already out, or the start of time when none is.
 * @param {number | null} seenAt when the box counts from as this device kept it, from its last
 *   dismissal or its first look, or null on its first look
 * @param {number[] | null} times when the Worker first noticed each update in the season the page
 *   has read, a time that only moves forward, never the device's clock, or null before the page
 *   has read its season
 * @param {(start: number) => void} keepStart
 */
export function readOrStartSeenAt(seenAt, times, keepStart) {
  if (seenAt !== null) return seenAt;
  if (times === null) return Infinity;
  const start = times.length ? Math.max(...times) : 0;
  keepStart(start);
  return start;
}

/**
 * Calls `onChange` whenever another tab dismisses the release notes.
 * @param {() => void} onChange
 */
export const watchNoteDismissals = (onChange) => noteClocks.watch(onChange);

// Only the box's first heading carries its dismiss button, which closes all of it.
/**
 * @param {string} title
 * @param {boolean} isFirst
 */
const renderHead = (title, isFirst) =>
  html`<div class="updates-head">
    <span class="updates-count">${title}</span>
    ${isFirst && html`<button type="button" class="updates-x" id="dismissUpdates" aria-label="Dismiss updates" title="Dismiss">${DISMISS_ICON}</button>`}
  </div>`;

/** @param {number} extra */
const renderMore = (extra) => extra > 0 && html`<li class="more">and ${extra} more</li>`;

/**
 * How many updates there are and since when, the newest dozen, and how many more.
 * @param {Update[]} updates newest first
 * @param {Date} today
 */
function renderUpdateList(updates, today) {
  const shown = updates.slice(0, MAX_SHOWN);
  const times = formatTimeColumn(shown, today);
  const extra = updates.length - shown.length;
  // The oldest update listed, not the last dismissal: a change can be found after a dismissal
  // but have happened before it.
  const since = formatSince(updates[updates.length - 1], today);
  const head = `${updates.length} update${updates.length === 1 ? "" : "s"} ${since}`;
  return html`${renderHead(head, true)}
    <ul class="updates-list">
      ${shown.map(
        (update, index) =>
          html`<li><span class="when">${times[index]}</span><span class="what">${update.text}</span>${update.action}</li>`,
      )}
      ${renderMore(extra)}
    </ul>`;
}

/**
 * The newest few release notes, and how many more.
 * @param {Note[]} notes newest first
 * @param {boolean} isFirst
 */
function renderNoteList(notes, isFirst) {
  const shown = notes.slice(0, MAX_NOTES_SHOWN);
  return html`<div class="${isFirst ? "updates-notes" : "updates-notes updates-section"}">
    ${renderHead("New in the app", isFirst)}
    <ul class="updates-list">
      ${shown.map((note) => html`<li><span class="what">${note.text}</span></li>`)}
      ${renderMore(notes.length - shown.length)}
    </ul>
  </div>`;
}

/**
 * The box's markup: the updates, newest first, and under them the release notes.
 * @param {Update[]} updates
 * @param {Note[]} [notes]
 * @param {Date} [today] a time on the day the updates' days count from, in the same days as theirs
 */
export const renderUpdates = (updates, notes = [], today = new Date()) =>
  html`${updates.length > 0 && renderUpdateList(updates, today)}${notes.length > 0 && renderNoteList(notes, !updates.length)}`;

// Redraws keep a box's markup when it hasn't changed, so each box listens for its dismiss button
// once, and calls whichever `dismiss` its latest showing handed it.
/** @type {WeakMap<HTMLElement, () => void>} */
const dismissals = new WeakMap();

/** @param {HTMLElement} panel */
function listenForDismiss(panel) {
  panel.addEventListener("click", (event) => {
    const target = /** @type {Element} */ (event.target);
    if (target.closest("#dismissUpdates")) dismissals.get(panel)?.();
  });
}

/** @type {WeakSet<HTMLElement>} */
const closingPanels = new WeakSet();

// A box that appears with new data grows open, pushing what's under it down smoothly, and one
// that fills again as it shrinks away stays open.
/**
 * @param {HTMLElement} panel
 * @param {Markup} markup
 */
function openBox(panel, markup) {
  if (closingPanels.delete(panel)) stopEasing(panel);
  if (panel.hidden) noteHeight(panel);
  panel.hidden = false;
  setHtml(panel, markup);
}

/** @param {HTMLElement} panel */
function hideBox(panel) {
  closingPanels.delete(panel);
  panel.hidden = true;
  setHtml(panel, html``);
}

// A box that empties keeps what it said while it shrinks away.
/** @param {HTMLElement} panel */
function closeBox(panel) {
  if (panel.hidden || closingPanels.has(panel)) return;
  closingPanels.add(panel);
  easeClosed(panel, () => hideBox(panel));
}

/**
 * @param {HTMLElement} panel
 * @param {Markup | null} markup null for a box with nothing to show
 */
function showBoxAtOnce(panel, markup) {
  if (!markup) {
    hideBox(panel);
    return;
  }
  panel.hidden = false;
  setHtml(panel, markup);
}

/**
 * @param {HTMLElement} panel
 * @param {Markup | null} markup null for a box with nothing to show
 */
function showBoxEased(panel, markup) {
  if (markup) openBox(panel, markup);
  else closeBox(panel);
}

/**
 * Shows the updates and release notes in the box, or hides it when there are none. Its dismiss
 * button calls `dismiss`, which forgets them. The box's first showing draws at once, as the rest
 * of the page does, and later ones ease it open or closed.
 * @param {HTMLElement} panel
 * @param {Update[]} updates newest first
 * @param {{ dismiss: () => void, notes?: Note[], today?: Date }} options
 */
export function showUpdates(panel, updates, { dismiss, notes = [], today = new Date() }) {
  const isFirstShowing = !dismissals.has(panel);
  if (isFirstShowing) listenForDismiss(panel);
  dismissals.set(panel, dismiss);
  const markup = updates.length || notes.length ? renderUpdates(updates, notes, today) : null;
  if (isFirstShowing) showBoxAtOnce(panel, markup);
  else showBoxEased(panel, markup);
}
