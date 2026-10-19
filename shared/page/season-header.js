// While a season's standings or bracket show, the header and all above the tab's pill ride up with
// the part shown as it scrolls, until the pill holds at the top, as a profile's tabs do in a
// phone's apps. Each part scrolls on its own from the top of the page, padded down to start under
// the pill (pager.css), so the browser moves what rides with a scroll-driven animation in step
// with the scroll, and a switch never scrolls the page: bracket-standings.js places the part a
// switch brings in before it shows. A browser without scroll-driven animations keeps the header
// still and each part under the pill. This plain script loads in the head and runs before the
// first paint, so a part put back scrolled shows the header where it was.

const findSeasonView = () =>
  /** @type {HTMLElement | null} */ (document.getElementById("view-bracket-standings"));
const findSeasonPill = () =>
  /** @type {HTMLElement} */ (document.getElementById("bracketStandingsPill"));
const findSeasonParts = () =>
  /** @type {HTMLElement[]} */ ([
    ...document.querySelectorAll("#bracketStandingsParts > .season-part"),
  ]);

/** The part the pill names as shown, as a reload put it back. */
function findPartNamed() {
  const tab = findSeasonPill().querySelector("[role=tab][aria-selected=true]");
  const name = /** @type {HTMLElement | null} */ (tab)?.dataset.tab;
  return findSeasonParts().find((part) => part.dataset.part === name) ?? findSeasonParts()[0];
}

/** @param {Element} element */
const isInFlow = (element) => ["static", "relative"].includes(getComputedStyle(element).position);

/**
 * Whether `element` holds a part fixed to the screen, like a phone's tab bar in the row of tabs,
 * which a transform would carry along.
 * @param {Element} element
 */
const holdsFixedPart = (element) =>
  [...element.querySelectorAll("*")].some((part) => getComputedStyle(part).position === "fixed");

/** What stands above the season tab's view on the page, but for its dialogs and scripts. */
function listAboveSeasonView() {
  const above = [];
  for (const element of document.body.children) {
    if (element === findSeasonView()) break;
    if (!["DIALOG", "SCRIPT"].includes(element.tagName))
      above.push(/** @type {HTMLElement} */ (element));
  }
  return above;
}

/** @type {HTMLElement[] | null} */
let riders = null;

/**
 * What rides above the pill: the page's own parts in its flow above the tab's view, not what stays
 * put on the screen. Each is marked `data-rides`, which pager.css draws over the parts. They change
 * only as the page's parts come and go or the screen changes size, as a phone's tab bar floats.
 * Each is measured unmarked, since the mark sets its own position.
 */
function findRiders() {
  if (riders) return riders;
  const above = listAboveSeasonView();
  for (const element of above) element.removeAttribute("data-rides");
  const found = above.filter((element) => isInFlow(element) && !holdsFixedPart(element));
  for (const element of found) element.setAttribute("data-rides", "");
  riders = found;
  return found;
}

/**
 * Where the parts start and how far the header rides, from the page laid out with nothing ridden:
 * the pill holds at the height its bar's band above it reaches down to. The ride is in whole pixels,
 * as far as Safari scrolls a part.
 * @param {HTMLElement} view
 */
function measureRide(view) {
  const pill = findSeasonPill();
  const viewTop = view.getBoundingClientRect().top - document.body.getBoundingClientRect().top;
  const pillTop = viewTop + pill.offsetTop;
  const holdTop = parseFloat(getComputedStyle(pill, "::before").height) || 0;
  return {
    viewTop,
    partsTop: pillTop + pill.offsetHeight,
    reach: Math.max(0, Math.round(pillTop - holdTop)),
    pageHeight: document.body.offsetHeight,
  };
}

/** @typedef {{ part: HTMLElement, movers: HTMLElement[], reach: number, range: number }} Ride */

/** @type {Animation[]} */
let rides = [];
/** @type {Ride | null} */
let ridden = null;
/** @type {HTMLElement | null} */
let followedPart = null;
/** @type {ResizeObserver | null} */
let roomWatcher = null;

function endRides() {
  for (const ride of rides) ride.cancel();
  rides = [];
  ridden = null;
}

/**
 * @param {Ride | null} before
 * @param {Ride} after
 */
const isSameRide = (before, after) =>
  !!before &&
  before.part === after.part &&
  before.reach === after.reach &&
  before.range === after.range &&
  before.movers.length === after.movers.length &&
  before.movers.every((mover, index) => mover === after.movers[index]);

/**
 * Has what rides, and the pill, ride `reach` pixels up over the first `reach` pixels `part`
 * scrolls, then hold, keeping the animations as they are while nothing they take has changed.
 * @param {HTMLElement} part
 * @param {number} reach
 */
function rideWith(part, reach) {
  const ride = {
    part,
    movers: [...findRiders(), findSeasonPill()],
    reach,
    range: part.scrollHeight - part.clientHeight,
  };
  if (isSameRide(ridden, ride)) return;
  endRides();
  ridden = ride;
  if (reach <= 0 || ride.range <= 0) return;
  const held = { transform: `translateY(${-reach}px)` };
  const timeline = new ScrollTimeline({ source: part, axis: "block" });
  const keyframes = [
    { transform: "none", offset: 0 },
    { ...held, offset: Math.min(1, reach / ride.range) },
    { ...held, offset: 1 },
  ];
  rides = ride.movers.map((mover) => mover.animate(keyframes, { timeline, fill: "both" }));
}

/**
 * Pads the parts down to start under the pill, from the top of the page, with room to scroll at
 * least as far as the header rides, so a part a switch brings in can always hold it where it is.
 * @param {HTMLElement} view
 * @param {ReturnType<typeof measureRide>} ride
 */
function placeParts(view, { viewTop, partsTop, reach, pageHeight }) {
  view.style.setProperty("--view-top", `${viewTop}px`);
  view.style.setProperty("--parts-top", `${partsTop}px`);
  view.style.setProperty("--header-reach", `${reach}px`);
  view.style.setProperty("--page-height", `${pageHeight}px`);
}

// A part put back scrolled before it showed, or before its room to scroll was known, takes its
// place once it shows.
function putBackScrolls() {
  for (const part of findSeasonParts()) {
    if (part.dataset.putBackTop === undefined || !part.getClientRects().length) continue;
    part.scrollTop = Number(part.dataset.putBackTop);
    delete part.dataset.putBackTop;
  }
}

// The ride changes whenever the tab shows, the page changes size, or what's above the parts or in a
// part comes, goes, or changes size. A browser hands a ResizeObserver every change of a frame at
// once, before it paints.
function watchRoom() {
  const watcher = new ResizeObserver((changes) => {
    if (changes.some(({ target }) => target === document.body)) riders = null;
    followSeasonPart();
  });
  const watchEach = () => {
    for (const element of listAboveSeasonView()) watcher.observe(element);
    for (const part of findSeasonParts()) for (const child of part.children) watcher.observe(child);
  };
  watcher.observe(document.body);
  watcher.observe(findSeasonPill());
  for (const part of findSeasonParts()) watcher.observe(part);
  watchEach();
  const comings = new MutationObserver(() => {
    riders = null;
    watchEach();
    followSeasonPart();
  });
  comings.observe(document.body, { childList: true });
  for (const part of findSeasonParts()) comings.observe(part, { childList: true });
  return watcher;
}

/**
 * Has the header ride with `part`, or the part it last rode with, or else the part the pill names,
 * whenever the tab shows, and holds it still on every other tab. Each new measure of the ride tells
 * the view, as a `headerride` event, so what the page draws from it, like the pill's line, draws
 * again.
 * @param {HTMLElement} [part]
 */
function followSeasonPart(part) {
  const view = findSeasonView();
  if (!view) return;
  roomWatcher ??= watchRoom();
  if (typeof ScrollTimeline !== "function") return putBackScrolls();
  view.dataset.follows = "";
  followedPart = part ?? followedPart ?? findPartNamed();
  if (!view.classList.contains("active")) return endRides();
  const ride = measureRide(view);
  placeParts(view, ride);
  putBackScrolls();
  rideWith(followedPart, ride.reach);
  view.dispatchEvent(new Event("headerride"));
}
