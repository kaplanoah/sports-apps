import {
  chooseCellLabel,
  choosePlacement,
  chooseTrip,
  describeWhyNoSlide,
  findCellScrollLeft,
  findDayScrollTop,
  isFollowingStartDay,
  isLedByOne,
  isRowOutOfSight,
  listShownDays,
  listStripDays,
  readFollowStartUntil,
} from "./day-strip-rules.js";
import {
  formatLongDate,
  formatMonth,
  formatShortMonth,
  formatShortWeekday,
  readCalendarDate,
  readDayOfMonth,
} from "./days.js";
import { dayStripLog } from "./day-strip-log.js";
import { html, setHtml } from "./html.js";
import { isAwayLong } from "./long-away.js";
import { chooseDayMarkup, hasStandIns, listDaysAround, measureNearDays } from "./near-days.js";
import { watchTimeAway } from "./resume.js";
import { scrollWithSpring } from "./spring-scroll.js";
import { endStripSlide, noteStripMissed, slideStripTo } from "./strip-slide.js";

// A season's games as one list of its game days, from its first to its last, under a bar holding
// a strip of every day between them. The strip's chosen day is the one at the top of the list, and
// follows it as it scrolls, passing to the next day once none of a day's text shows; a tap on a day, or on Today, brings that day to the top, a day's gap
// under the bar, so nothing of the day before shows. A tap on a date without games brings in its
// No games row, which leaves once it's out of sight, and a tap on Today while the list is already
// there brings the date back to the strip's middle, or, with the strip there too, pulses it. While
// a finger moves the strip, the month names the day in its middle.
// The list opens on its start day, today or the day the app names, and goes back there once
// someone has been away two minutes, following it for a few seconds as the store catches up. A league hands it each game day's markup, as it draws a day
// elsewhere, and a date without games' markup. A league with many games a day can also hand over
// a stand-in for each day, as tall as its games, which the list draws in place of a day far from
// its top, so it holds only the games near the screen.

/** @typedef {import("./html.js").Markup} Markup */
/**
 * A "YYYY-MM-DD" day and its games, and the stand-in for them while the day is far from the list's
 * top, when the league has one.
 * @typedef {{ day: string, markup: Markup, farMarkup?: Markup }} ListedDay
 */
/**
 * @typedef {object} DayStripFill
 * @property {ListedDay[]} days each game day, in order
 * @property {string} today the viewer's "YYYY-MM-DD" date
 * @property {string} startDay the day the list opens on and Today brings to the top
 * @property {string} emptyNote what the view says while it has no days
 * @property {(day: string) => Markup} renderQuietDay a date without games, as the list shows it
 */

// Phosphor's calendar-dot, at its Regular weight, as beside the words of a Read button.
const CALENDAR_DOT = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M208,32H184V24a8,8,0,0,0-16,0v8H88V24a8,8,0,0,0-16,0v8H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM72,48v8a8,8,0,0,0,16,0V48h80v8a8,8,0,0,0,16,0V48h24V80H48V48ZM208,208H48V96H208V208Zm-64-56a16,16,0,1,1-16-16A16,16,0,0,1,144,152Z"/></svg>`;

// A tap on Today while the list is already there grows the date this much and back, this fast.
const PULSE_SCALE = 1.04;
const PULSE_MS = 290;

/** @type {HTMLElement | null} */
let view = null;
/** @type {DayStripFill | null} */
let shown = null;
/** @type {string | null} */
let chosenDay = null;
// A day a tap or Today sent the list to stays chosen while the list travels there, and until it
// moves away again, since the season's last days can't all reach the top.
// Where its top was last seen, for Diagnostics to say when it moves while the list travels.
/** @type {{ day: string, hasArrived: boolean, top: number | null } | null} */
let held = null;
let isPlaced = false;
// The day at the top of the list and how far its top sits from the list's, kept while the list
// shows, so the list can take it back after a redraw, or once its tab shows again.
/** @type {{ day: string, offset: number } | null} */
let anchor = null;
// A date without games that a tap brought into the list, until it's out of sight.
/** @type {string | null} */
let quietDay = null;
// Until when the list held on its start day follows it to a new one.
let followStartUntil = 0;
// A finger or wheel moving the strip has the month name the day in its middle, until the list moves.
let isStripSwiped = false;
// The strip's dates slide only while a finger or wheel has moved the list, since the list's own
// moves, as it's placed, redrawn, or sent to a day, already choose their day.
let isListInHand = false;
/** @type {Map<string, string>} */
const drawnDays = new Map();
// The days drawn whole, rather than as a stand-in.
/** @type {Set<string>} */
let nearDays = new Set();

const findBar = () => /** @type {HTMLElement | null} */ (view?.querySelector(".day-bar") ?? null);
const findStrip = () =>
  /** @type {HTMLElement | null} */ (view?.querySelector(".day-strip") ?? null);
const findList = () => /** @type {HTMLElement | null} */ (view?.querySelector(".day-list") ?? null);

// The view names the day the list is held on, and whether it has arrived, for Diagnostics to say.
/** @param {typeof held} next */
function setHeld(next) {
  held = next;
  if (!view) return;
  if (next) view.dataset.heldDay = next.day;
  else delete view.dataset.heldDay;
  delete view.dataset.heldArrived;
}

/**
 * A day's label in the strip, as its rule chooses it.
 * @param {string} day
 * @param {string} today
 */
function renderCellLabel(day, today) {
  const date = readCalendarDate(day);
  const label = chooseCellLabel(day, today);
  if (label === "today") return html`<span class="cell-name">Today</span>`;
  if (label === "month") return html`<span class="cell-month">${formatShortMonth(date)}</span>`;
  return html`<span class="cell-name">${formatShortWeekday(date)}</span>`;
}

/**
 * @param {string} day
 * @param {{ today: string, isListed: boolean, isChosen: boolean }} state
 */
function renderCell(day, { today, isListed, isChosen }) {
  const date = readCalendarDate(day);
  const isToday = day === today;
  const label = renderCellLabel(day, today);
  const classes = [
    "day-cell",
    isToday && "is-today",
    isChosen && "is-chosen",
    !isListed && "is-quiet",
  ]
    .filter(Boolean)
    .join(" ");
  const content = html`${label}<span class="cell-number${isLedByOne(day) ? " leads-with-one" : ""}">${readDayOfMonth(day)}</span>`;
  return html`<button type="button" class="${classes}" data-day="${day}" aria-label="${formatLongDate(date)}"${isToday ? html` aria-current="date"` : ""}>${content}</button>`;
}

/** @param {DayStripFill} fill */
function renderCells({ days, today }) {
  const listed = new Set(days.map(({ day }) => day));
  return html`${listStripDays(days).map((day) =>
    renderCell(day, { today, isListed: listed.has(day), isChosen: day === chosenDay }),
  )}`;
}

/** @param {string} day */
const renderMonth = (day) => formatMonth(readCalendarDate(day));

/** @param {DayStripFill} fill */
const renderBar = (fill) =>
  html`<div class="day-bar-head">
      <p class="strip-month">${renderMonth(chosenDay ?? fill.startDay)}</p>
      <button type="button" class="go-today">${CALENDAR_DOT}<span>Today</span></button>
    </div>
    <div class="day-strip" role="group" aria-label="Days">${renderCells(fill)}</div>`;

/**
 * The days the list shows: each game day, and the date without games a tap brought in.
 * @param {DayStripFill} fill
 */
const listFillDays = (fill) => listShownDays(fill.days, quietDay, fill.renderQuietDay);

/**
 * The days drawn whole: those within a few screens of what the list shows and of the day a tap or
 * Today sends it to. A league without stand-ins draws every day whole, so the list isn't measured.
 * @param {DayStripFill} fill
 * @param {ListedDay[]} days
 */
function listNearDays(fill, days) {
  if (!hasStandIns(days)) return new Set();
  const list = findList();
  const target = held?.day ?? chosenDay ?? fill.startDay;
  const targetDay = findListedDay(target);
  if (!list || !targetDay || !isListShown()) return listDaysAround(days, target);
  return measureNearDays(list, days, [list.scrollTop, targetDay.offsetTop], findListedDay);
}

/**
 * What the list draws for a day: its games, or its stand-in while it's far from what shows.
 * @param {ListedDay} listed
 */
const chooseDrawnMarkup = (listed) => chooseDayMarkup(listed, nearDays);

// Keyed by its date, a day keeps its own node as days come and go around it, rather than being
// rewritten with its neighbor's games.
/**
 * @param {string} day
 * @param {Markup} markup
 */
const renderListedDay = (day, markup) =>
  html`<div class="listed-day" data-day="${day}" data-key="${day}">${markup}</div>`;

/**
 * @param {DayStripFill} fill
 * @param {ListedDay[]} days
 */
const renderView = (fill, days) =>
  html`<div class="day-bar">${renderBar(fill)}</div>
    <div class="day-list">${days.map((listed) => renderListedDay(listed.day, chooseDrawnMarkup(listed)))}</div>`;

/** @param {string} day */
const findListedDay = (day) =>
  /** @type {HTMLElement | null} */ (findList()?.querySelector(`[data-day="${day}"]`) ?? null);

/** @param {string} day */
const findCell = (day) =>
  /** @type {HTMLElement | null} */ (findStrip()?.querySelector(`[data-day="${day}"]`) ?? null);

/**
 * @param {HTMLElement} strip
 * @param {HTMLElement} cell
 */
const findCellLeft = (strip, cell) =>
  findCellScrollLeft({
    cellLeft: cell.offsetLeft,
    cellWidth: cell.offsetWidth,
    scrollWidth: strip.scrollWidth,
    clientWidth: strip.clientWidth,
  });

/** @param {ScrollBehavior} behavior */
function centerChosenCell(behavior) {
  const strip = findStrip();
  const cell = chosenDay && findCell(chosenDay);
  if (!strip || !cell) return;
  const left = findCellLeft(strip, cell);
  strip.scrollTo({ left, behavior });
  if (behavior === "instant") noteStripMissed(strip, left);
}

function isStripOnChosenDay() {
  const strip = findStrip();
  const cell = chosenDay && findCell(chosenDay);
  return !!strip && !!cell && Math.abs(strip.scrollLeft - findCellLeft(strip, cell)) < 2;
}

// A day sent to the list's top while it's already chosen brings its date back to the strip's
// middle, and its month back over it, from wherever a finger left the strip.
/** @param {ScrollBehavior} behavior */
function bringBackChosenCell(behavior) {
  endStripSlide();
  if (!chosenDay || isStripOnChosenDay()) return;
  dayStripLog.noteStep(`the strip comes back to ${chosenDay}`);
  isStripSwiped = false;
  showMonth(chosenDay);
  centerChosenCell(behavior);
}

/** @param {string} day */
function showMonth(day) {
  const month = view?.querySelector(".strip-month");
  const name = renderMonth(day);
  if (month && month.textContent !== name) month.textContent = name;
}

/**
 * @param {string} day
 * @param {ScrollBehavior} behavior
 */
function chooseDay(day, behavior) {
  if (day === chosenDay) return;
  endStripSlide();
  markChosen(day);
  centerChosenCell(behavior);
}

/** @param {string} day */
function markChosen(day) {
  if (chosenDay) findCell(chosenDay)?.classList.remove("is-chosen");
  chosenDay = day;
  findCell(day)?.classList.add("is-chosen");
  showMonth(day);
  drawNearDays();
}

/**
 * The list's top day becomes the chosen one, its date sliding under the box as the list scrolls.
 * @param {string} day
 */
function followTopDay(day) {
  if (day === chosenDay) return;
  const strip = findStrip();
  const from = chosenDay && findCell(chosenDay);
  const to = findCell(day);
  const cannotSlide = describeWhyNoSlide({
    hasCells: !!strip && !!from && !!to,
    isListInHand,
    isReducedMotion: isReducedMotion(),
  });
  dayStripLog.noteStep(
    `top day ${day}, ${cannotSlide ? `chosen at once: ${cannotSlide}` : "slide"}`,
  );
  if (!strip || !from || !to || cannotSlide) {
    chooseDay(day, "instant");
    return;
  }
  slideStripTo(strip, from, to);
  markChosen(day);
}

/** The strip's day under the middle of its width. */
function findMiddleCell() {
  const strip = findStrip();
  const cells = /** @type {HTMLElement[]} */ ([...(strip?.children ?? [])]);
  if (!strip || !cells.length) return null;
  const middle = strip.scrollLeft + strip.clientWidth / 2;
  let low = 0;
  let high = cells.length - 1;
  while (low < high) {
    const index = Math.ceil((low + high) / 2);
    if (cells[index].offsetLeft <= middle) low = index;
    else high = index - 1;
  }
  return cells[low].dataset.day ?? null;
}

let isStripFramePending = false;
function followStrip() {
  if (isStripFramePending || !isStripSwiped) return;
  isStripFramePending = true;
  requestAnimationFrame(() => {
    isStripFramePending = false;
    const middle = isStripSwiped && findMiddleCell();
    if (middle) showMonth(middle);
  });
}

/**
 * The lowest any of a day's text ends on the screen, or null when none of it is laid out to measure.
 * @param {HTMLElement} listed
 */
function findTextBottom(listed) {
  const walker = document.createTreeWalker(listed, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let bottom = null;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.nodeValue?.trim()) continue;
    range.selectNodeContents(text);
    for (const rect of range.getClientRects()) {
      if (rect.height) bottom = Math.max(bottom ?? rect.bottom, rect.bottom);
    }
  }
  return bottom;
}

/**
 * Whether any of a day's text still shows under the list's top.
 * @param {HTMLElement} listed
 * @param {HTMLElement} list
 */
function isTextInSight(listed, list) {
  const top = list.getBoundingClientRect().top + list.clientTop;
  const bottom = findTextBottom(listed) ?? listed.getBoundingClientRect().bottom;
  return bottom > top;
}

/** The day at the top of the list: the first with any of its text still in sight. */
function findTopDay() {
  const list = findList();
  const listed = /** @type {HTMLElement[]} */ ([...(list?.children ?? [])]);
  if (!list || !listed.length) return null;
  let low = 0;
  let high = listed.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (listed[middle].offsetTop <= list.scrollTop) low = middle;
    else high = middle - 1;
  }
  const isPassed = low < listed.length - 1 && !isTextInSight(listed[low], list);
  return listed[isPassed ? low + 1 : low].dataset.day ?? null;
}

const isReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** @returns {ScrollBehavior} */
const chooseMotion = () => (isReducedMotion() ? "instant" : "smooth");

// The list keeps the gap between its days above its first, which is the gap a day brought to the
// top keeps under the bar.
/** @param {HTMLElement} list */
const readDayGap = (list) => Number.parseFloat(getComputedStyle(list).paddingTop) || 0;

/**
 * Where the list stands with `day` a day's gap under its top, or as near as its ends let it.
 * @param {string} day
 */
function findDayTop(day) {
  const list = findList();
  const listed = findListedDay(day);
  if (!list || !listed) return null;
  return findDayScrollTop({
    dayTop: listed.offsetTop,
    gap: readDayGap(list),
    scrollHeight: list.scrollHeight,
    clientHeight: list.clientHeight,
  });
}

/**
 * @param {string} day
 * @param {"instant" | "flown"} motion
 */
function showDay(day, motion) {
  const list = findList();
  const top = findDayTop(day);
  if (!list || top === null) {
    dayStripLog.noteStep(`${day} isn't in the list`);
    return;
  }
  setHeld({ day, hasArrived: false, top });
  isListInHand = false;
  // A list already there doesn't scroll, so nothing else would see it arrive.
  if (Math.abs(top - list.scrollTop) < 2) markHeldArrived();
  const trip = chooseTrip({
    motion,
    distance: top - list.scrollTop,
    screenHeight: list.clientHeight,
    isReducedMotion: isReducedMotion(),
  });
  const isJump = trip === "jump";
  dayStripLog.noteStep(
    `${isJump ? "jump" : "fly"} to ${day}, list ${Math.round(list.scrollTop)} to ${Math.round(top)}`,
  );
  if (isJump) list.scrollTo({ top, behavior: "instant" });
  else scrollWithSpring(list, top);
  const behavior = motion === "instant" ? "instant" : chooseMotion();
  if (day === chosenDay) bringBackChosenCell(behavior);
  else chooseDay(day, behavior);
}

// The day's place is read again each time, since the list's end can move as its days draw.
function isStillHeld() {
  const list = findList();
  const top = held && findDayTop(held.day);
  if (!held || !list || top === null) return false;
  noteHeldPlace(held, top);
  const isAtTarget = Math.abs(list.scrollTop - top) < 2;
  if (isAtTarget) markHeldArrived();
  else if (held.hasArrived) {
    dayStripLog.noteStep(`left ${held.day}, list at ${Math.round(list.scrollTop)}`);
    setHeld(null);
  }
  return !!held;
}

function markHeldArrived() {
  if (!held || held.hasArrived) return;
  dayStripLog.noteStep(`arrived at ${held.day}`);
  held.hasArrived = true;
  if (view) view.dataset.heldArrived = "true";
}

/**
 * Logs a held day's place moving while the list travels to it or rests there.
 * @param {NonNullable<typeof held>} holding
 * @param {number} top
 */
function noteHeldPlace(holding, top) {
  if (holding.top !== null && Math.abs(top - holding.top) >= 1)
    dayStripLog.noteStep(
      `${holding.day}'s place moved from ${Math.round(holding.top)} to ${Math.round(top)}`,
    );
  holding.top = top;
}

// A list that changes height, as when the header above it does, keeps the day a tap or Today sent
// it to at its top.
function keepHeldDay() {
  const list = findList();
  const top = held?.hasArrived && findDayTop(held.day);
  if (list && typeof top === "number") list.scrollTop = top;
}

// The bar ends in a line once a day has scrolled under it.
function markStuck() {
  findBar()?.classList.toggle("stuck", (findList()?.scrollTop ?? 0) > 0);
}

let isFramePending = false;
function followList() {
  if (isFramePending) return;
  isFramePending = true;
  requestAnimationFrame(() => {
    isFramePending = false;
    markStuck();
    drawNearDays();
    const top = findTopDay();
    if (top && !isStillHeld()) followTopDay(top);
    if (isStripSwiped && chosenDay) showMonth(chosenDay);
    isStripSwiped = false;
    noteAnchor();
    dropQuietDayOutOfSight();
  });
}

const isListShown = () => (findList()?.clientHeight ?? 0) > 0;

function noteAnchor() {
  const list = findList();
  const listed = chosenDay && findListedDay(chosenDay);
  if (list && listed && isListShown())
    anchor = { day: /** @type {string} */ (chosenDay), offset: listed.offsetTop - list.scrollTop };
}

function takeBackAnchor() {
  if (anchor) placeDay(anchor);
}

/**
 * Brings a day back to where its top sat under the list's.
 * @param {{ day: string, offset: number }} place
 */
function placeDay({ day, offset }) {
  const list = findList();
  const listed = findListedDay(day);
  if (list && listed) list.scrollTop = listed.offsetTop - offset;
}

// Where the list stands at the start day, which a page that loads again after two minutes away
// opens on (show-last-drawn.js).
function noteStartTop() {
  const list = findList();
  const top = shown && findDayTop(shown.startDay);
  if (list && typeof top === "number") list.dataset.startTop = String(top);
}

/**
 * Brings the start day to the top, as Today does.
 * @param {"instant" | "flown"} [motion]
 */
export function showStartDay(motion = "flown") {
  if (shown?.days.length) showDay(shown.startDay, motion);
}

/** Has the next fill open the list on its start day, as for another season. */
export function startOverDayStrip() {
  endStripSlide();
  isPlaced = false;
  chosenDay = null;
  nearDays = new Set();
  setHeld(null);
  anchor = null;
  quietDay = null;
  isStripSwiped = false;
  isListInHand = false;
}

/**
 * @param {ListedDay[]} days
 * @returns {boolean} whether the list draws these days already, in the same order
 */
function hasSameDays(days) {
  const drawn = [...drawnDays.keys()];
  return (
    !!findList() &&
    drawn.length === days.length &&
    drawn.every((day, index) => days[index].day === day)
  );
}

/**
 * @param {ListedDay} listed
 * @returns {boolean} whether the day was drawn again
 */
function drawListedDay(listed) {
  const drawn = chooseDrawnMarkup(listed);
  const markup = String(drawn);
  if (drawnDays.get(listed.day) === markup) return false;
  const element = findListedDay(listed.day);
  if (element) setHtml(element, drawn);
  drawnDays.set(listed.day, markup);
  return true;
}

/**
 * How far a day's top sits under the list's, or null while the list isn't showing.
 * @param {string} day
 */
function measureDayOffset(day) {
  const list = findList();
  const listed = findListedDay(day);
  return list && listed && isListShown() ? listed.offsetTop - list.scrollTop : null;
}

/** The day at the top of the list and how far its top sits under the list's, for Diagnostics. */
function measureTopDay() {
  const day = isListShown() ? findTopDay() : null;
  const offset = day === null ? null : measureDayOffset(day);
  return day === null || offset === null ? null : { day, offset };
}

/** @param {{ day: string, offset: number } | null} top */
const describeTopDay = (top) =>
  top ? `${top.day} at the top, ${Math.round(top.offset)}px down` : "the list isn't showing";

// Only the days whose games changed are drawn again, so a live game's update doesn't redraw the
// season.
/**
 * @param {ListedDay[]} days
 * @returns {number} how many days were drawn again
 */
function redrawChangedDays(days) {
  return days.filter((listed) => drawListedDay(listed)).length;
}

// As the list moves, only the days that came near what it shows, or left, are drawn again. A
// stand-in is as tall as the games it stands for, so drawing a day whole or not moves nothing.
function drawNearDays() {
  if (!shown || !hasStandIns(shown.days)) return;
  const days = listFillDays(shown);
  if (!hasSameDays(days)) return;
  const before = nearDays;
  nearDays = listNearDays(shown, days);
  const changed = days.filter((listed) => before.has(listed.day) !== nearDays.has(listed.day));
  if (dayStripLog.isLogging()) drawDaysNoting(changed);
  else for (const listed of changed) drawListedDay(listed);
}

/**
 * Draws each day, logging any whose height changed as it was drawn whole or as a stand-in, and how
 * far that moved the day at the top.
 * @param {ListedDay[]} days
 */
function drawDaysNoting(days) {
  const top = measureTopDay();
  const resized = [];
  for (const listed of days) {
    const element = findListedDay(listed.day);
    const height = element?.getBoundingClientRect().height;
    drawListedDay(listed);
    const drawnHeight = element?.getBoundingClientRect().height;
    if (height !== drawnHeight)
      resized.push(`${listed.day} ${nameDrawing(listed)} ${height}px to ${drawnHeight}px`);
  }
  if (!resized.length) return;
  const offset = top && measureDayOffset(top.day);
  const moved = top && offset !== null ? `, which moved ${top.day} ${offset - top.offset}px` : "";
  dayStripLog.noteStep(`a day changed height as it was drawn: ${resized.join("; ")}${moved}`);
}

/** @param {ListedDay} listed */
const nameDrawing = (listed) =>
  chooseDrawnMarkup(listed) === listed.markup ? "whole" : "as a stand-in";

/**
 * Writes the bar again, and each day that shows something else than it last did, since a write of
 * the whole view keeps what each part written on its own last showed (setHtml in html.js), as the
 * bar is when the days stay the same and a day is when only it changes.
 * @param {DayStripFill} fill
 * @param {ListedDay[]} days
 * @param {Map<string, string>} drawnBefore what each day showed before
 */
function redrawWrittenParts(fill, days, drawnBefore) {
  const bar = findBar();
  if (bar) setHtml(bar, renderBar(fill));
  for (const listed of days) {
    const markup = chooseDrawnMarkup(listed);
    const element = findListedDay(listed.day);
    const isChanged = drawnBefore.has(listed.day) && drawnBefore.get(listed.day) !== String(markup);
    if (element && isChanged) setHtml(element, markup);
  }
}

/**
 * @param {DayStripFill} fill
 * @returns {string} what it drew, for Diagnostics, or an empty string when nothing changed
 */
function drawFill(fill) {
  endStripSlide();
  const bar = findBar();
  const days = listFillDays(fill);
  nearDays = listNearDays(fill, days);
  if (hasSameDays(days) && bar) {
    setHtml(bar, renderBar(fill));
    const changed = redrawChangedDays(days);
    return changed ? `redraw ${changed} of ${days.length} days` : "";
  }
  const drawnBefore = new Map(drawnDays);
  setHtml(/** @type {HTMLElement} */ (view), renderView(fill, days));
  redrawWrittenParts(fill, days, drawnBefore);
  drawnDays.clear();
  for (const listed of days) drawnDays.set(listed.day, String(chooseDrawnMarkup(listed)));
  fitEndRoom();
  return `draw ${days.length} days, from ${days[0].day} to ${days.at(-1)?.day}, starting on ${fill.startDay}`;
}

// Room after the last day lets it reach the top as every other day does, so scrolling the list
// takes the strip's chosen day to the season's last.
function fitEndRoom() {
  const list = findList();
  const last = /** @type {HTMLElement | null | undefined} */ (list?.lastElementChild);
  if (!list || !last || !isListShown()) return;
  const room = Math.max(0, list.clientHeight - last.offsetHeight - readDayGap(list));
  list.style.setProperty("--end-room", `${room}px`);
}

// The list draws its days again with or without a date without games, keeping its top day where
// it is.
function redrawKeepingTopDay() {
  if (!shown) return;
  noteAnchor();
  drawFill(shown);
  takeBackAnchor();
}

/** @param {string} day */
function openQuietDay(day) {
  if (quietDay === day) return;
  quietDay = day;
  redrawKeepingTopDay();
}

const isQuietDayOutOfSight = (/** @type {HTMLElement} */ list, /** @type {HTMLElement} */ row) =>
  isRowOutOfSight({
    rowTop: row.offsetTop,
    rowHeight: row.offsetHeight,
    scrollTop: list.scrollTop,
    clientHeight: list.clientHeight,
  });

// The No games row a tap brought in leaves once it's out of sight, without moving the list.
function dropQuietDayOutOfSight() {
  const list = findList();
  const row = quietDay && findListedDay(quietDay);
  if (!list || !row || held?.day === quietDay || !isQuietDayOutOfSight(list, row)) return;
  quietDay = null;
  redrawKeepingTopDay();
}

// A list that isn't showing, as on another tab, has no place to keep, so it's placed once it
// shows: on its start day the first time, unless the page put it back on a day it still lists as
// it loaded again (show-last-drawn.js), and after that on the day it last had at its top. The day
// goes back rather than the scroll, since the first fill can list other days than the page put
// back, as a season the page last showed without its whole schedule does.
/**
 * @param {{ day: string, offset: number } | null} putBackDay the day the page put back at the
 *   list's top as it loaded, if it did
 */
function placeList(putBackDay) {
  const list = findList();
  if (!shown || !list || !isListShown()) return;
  const placement = choosePlacement({
    isPlaced,
    hasPutBackDay: !!putBackDay && !!findListedDay(putBackDay.day),
  });
  if (placement === "last place") takeBackAnchor();
  else if (placement === "put back" && putBackDay) placeDay(putBackDay);
  else showDay(shown.startDay, "instant");
  isPlaced = true;
  noteStartTop();
  markStuck();
  const top = findTopDay();
  if (top && !isStillHeld()) chooseDay(top, "instant");
  noteAnchor();
}

/**
 * Draws the season's days, keeping the day at the top of the list where it is.
 * @param {DayStripFill} fill
 */
export function fillDayStrip(fill) {
  if (!view) return;
  if (!fill.days.length) {
    setHtml(view, html`<p class="empty-note">${fill.emptyNote}</p>`);
    shown = fill;
    return;
  }
  const putBackDay = readPutBackDay();
  const lastStartDay = shown?.startDay;
  if (isListShown()) noteAnchor();
  const before = dayStripLog.isLogging() ? measureTopDay() : null;
  const drawing = drawFill(fill);
  shown = fill;
  fitEndRoom();
  placeList(putBackDay);
  if (dayStripLog.isLogging()) noteFill(drawing, before, measureTopDay());
  if (lastStartDay) followStartDay(lastStartDay);
}

/**
 * The day the page put back at the list's top as it loaded, before the list's first fill, or null
 * when it didn't or put it back on its start day, as after a long time away, where the fill places
 * it.
 */
function readPutBackDay() {
  const putBack = !shown && isListShown() ? findList() : null;
  if (!putBack) return null;
  if (putBack.dataset.putBackStart === "true") {
    startFollowingStart();
    return null;
  }
  return findDayAt(putBack, Number(putBack.dataset.putBackTop ?? putBack.scrollTop));
}

/**
 * The first day still showing under `top` in the list, and how far its top sits under it.
 * @param {HTMLElement} list
 * @param {number} top
 */
function findDayAt(list, top) {
  const listed = /** @type {HTMLElement[]} */ ([...list.children]);
  const found = listed.find((each) => each.offsetTop + each.offsetHeight > top) ?? listed.at(-1);
  const day = found?.dataset.day;
  return day ? { day, offset: found.offsetTop - top } : null;
}

function startFollowingStart() {
  followStartUntil = readFollowStartUntil(Date.now());
}

/**
 * Moves a list still held on its last start day to its new one.
 * @param {string} lastStartDay
 */
function followStartDay(lastStartDay) {
  const startDay = shown?.startDay;
  if (!startDay || !isListShown()) return;
  const isFollowing = isFollowingStartDay({
    now: Date.now(),
    followStartUntil,
    heldDay: held?.day ?? null,
    lastStartDay,
    startDay,
  });
  if (!isFollowing) return;
  dayStripLog.noteStep(`the start day moved from ${lastStartDay} to ${startDay}`);
  showDay(startDay, "instant");
}

/**
 * Logs what a fill drew and where it left the list, when it drew anything or moved the list.
 * @param {string} drawing
 * @param {{ day: string, offset: number } | null} before
 * @param {{ day: string, offset: number } | null} after
 */
function noteFill(drawing, before, after) {
  const isSame =
    before?.day === after?.day && Math.abs((before?.offset ?? 0) - (after?.offset ?? 0)) < 1;
  if (!drawing && isSame) return;
  const was = isSame || !before ? "" : `, was ${describeTopDay(before)}`;
  dayStripLog.noteStep(`${drawing || "redraw nothing"}; ${describeTopDay(after)}${was}`);
}

// A finger or wheel on the list takes it over, even on its way to a day, and one on the strip has
// the month follow it.
/** @param {Event} event */
function noteTouch(event) {
  const target = /** @type {Node} */ (event.target);
  followStartUntil = 0;
  if (findList()?.contains(target)) isListInHand = true;
  if (held && findList()?.contains(target)) {
    dayStripLog.noteStep(`the list's touch takes it over on its way to ${held.day}`);
    setHeld(null);
  }
  if (findStrip()?.contains(target)) {
    endStripSlide();
    isStripSwiped = true;
  }
}

function isOnStartDay() {
  const list = findList();
  const top = shown && findDayTop(shown.startDay);
  return (
    !!list &&
    !!shown &&
    chosenDay === shown.startDay &&
    typeof top === "number" &&
    Math.abs(list.scrollTop - top) < 2 &&
    isStripOnChosenDay()
  );
}

// A tap on Today where the list and the strip already are has nowhere to go, so the date says
// it's there.
function pulseStartDay() {
  const cell = shown && findCell(shown.startDay);
  dayStripLog.noteStep(
    `already on ${shown?.startDay}, ${isReducedMotion() ? "less motion, no pulse" : "pulse"}`,
  );
  if (!cell || isReducedMotion()) return;
  cell.animate(
    [
      { transform: "scale(1)" },
      { transform: `scale(${PULSE_SCALE})`, offset: 0.4 },
      { transform: "scale(1)" },
    ],
    { duration: PULSE_MS, easing: "ease-out" },
  );
}

/** @param {Event} event */
function openTappedDay(event) {
  const target = /** @type {Element} */ (event.target);
  if (target.closest(".go-today")) {
    if (isOnStartDay()) pulseStartDay();
    else showStartDay();
    return;
  }
  const cell = /** @type {HTMLElement | null} */ (target.closest(".day-cell"));
  const day = cell?.dataset.day;
  if (!cell || !day) return;
  if (cell.classList.contains("is-quiet")) openQuietDay(day);
  showDay(day, "flown");
}

// Safari loses a scroll made as the page comes back, before it draws again, so the list moves in
// the first frame it draws. A list on another tab can't move, so it opens on the start day once
// it's shown, as on a page's first load.
/** @param {number} awayMs */
function showStartAfterLongAway(awayMs) {
  if (!isAwayLong(awayMs)) return;
  startFollowingStart();
  if (isListShown()) requestAnimationFrame(() => showStartDay("instant"));
  else startOverDayStrip();
}

/**
 * Wires the view in `element`, which `fillDayStrip` fills.
 * @param {HTMLElement} element
 */
export function startDayStrip(element) {
  view = element;
  element.addEventListener("click", openTappedDay);
  element.addEventListener(
    "scroll",
    (event) => {
      if (event.target === findList()) followList();
      else if (event.target === findStrip()) followStrip();
    },
    { capture: true, passive: true },
  );
  for (const type of ["touchstart", "wheel"])
    element.addEventListener(type, noteTouch, { capture: true, passive: true });
  // The page saves what it shows as it leaves (last-seen.js), so the strip comes to rest first.
  for (const type of ["visibilitychange", "pagehide"])
    addEventListener(type, endStripSlide, { capture: true });
  watchTimeAway(showStartAfterLongAway);
  let wasShown = false;
  new ResizeObserver(() => {
    const isShown = isListShown();
    if (isShown) fitEndRoom();
    if (isShown && wasShown) keepHeldDay();
    if (isShown && !wasShown) placeList(null);
    wasShown = isShown;
  }).observe(element);
}
