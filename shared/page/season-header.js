// While a season's standings or bracket show, the header and all above the tab's pill ride up with
// the part shown as it scrolls, until the pill holds at the top, as a profile's tabs do in a
// phone's apps. Each part scrolls on its own from the top of the page, padded down to start under
// the pill (pager.css), so the browser moves what rides with a scroll-driven animation in step
// with the scroll, and a switch never scrolls the page: bracket-standings.js places the part a
// switch brings in before it shows. A browser without scroll-driven animations keeps the header
// still and each part under the pill. This plain script loads in the head, and the page calls
// followSeasonPart() right after showLastDrawn(), before anything is painted, so a part put back
// scrolled shows the header where it was; bracket-standings.js calls it for each part it shows.

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

/**
 * What rides with the part: the page's own parts in its flow above the tab's view, not what stays
 * put on the screen, and the pill.
 */
const listRiders = () => [
  ...listAboveSeasonView().filter((element) => isInFlow(element) && !holdsFixedPart(element)),
  findSeasonPill(),
];

/**
 * Where the parts start and how far the header rides, from the page laid out with nothing ridden:
 * the pill holds at the height its bar's band above it reaches down to.
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
    reach: Math.max(0, pillTop - holdTop),
    pageHeight: document.body.offsetHeight,
  };
}

/** @type {Animation[]} */
let rides = [];
/** @type {HTMLElement | null} */
let followedPart = null;
/** @type {ResizeObserver | null} */
let roomWatcher = null;

function endRides() {
  for (const ride of rides) ride.cancel();
  rides = [];
}

/**
 * Has `riders` ride `reach` pixels up over the first `reach` pixels `part` scrolls, then hold.
 * @param {HTMLElement} part
 * @param {HTMLElement[]} riders
 * @param {number} reach
 */
function rideWith(part, riders, reach) {
  endRides();
  const range = part.scrollHeight - part.clientHeight;
  if (reach <= 0 || range <= 0) return;
  const held = { transform: `translateY(${-reach}px)` };
  const timeline = new ScrollTimeline({ source: part, axis: "block" });
  const keyframes = [
    { transform: "none", offset: 0 },
    { ...held, offset: Math.min(1, reach / range) },
    { ...held, offset: 1 },
  ];
  rides = riders.map((rider) => rider.animate(keyframes, { timeline, fill: "both" }));
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

// A part put back scrolled before its room to scroll was known takes its place again.
function putBackScrolls() {
  for (const part of findSeasonParts()) {
    if (part.dataset.putBackTop !== undefined) part.scrollTop = Number(part.dataset.putBackTop);
    delete part.dataset.putBackTop;
  }
}

// The ride changes whenever the tab shows, the page changes size, or what's above the parts or in a
// part comes, goes, or changes size.
function watchRoom() {
  const watcher = new ResizeObserver(() => followSeasonPart());
  const watchEach = () => {
    for (const element of listAboveSeasonView()) watcher.observe(element);
    for (const part of findSeasonParts()) for (const child of part.children) watcher.observe(child);
  };
  watcher.observe(document.body);
  watcher.observe(findSeasonPill());
  for (const part of findSeasonParts()) watcher.observe(part);
  watchEach();
  const comings = new MutationObserver(() => {
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
  if (typeof ScrollTimeline !== "function") return putBackScrolls();
  view.dataset.follows = "";
  followedPart = part ?? followedPart ?? findPartNamed();
  roomWatcher ??= watchRoom();
  if (!view.classList.contains("active")) return endRides();
  const ride = measureRide(view);
  placeParts(view, ride);
  putBackScrolls();
  rideWith(followedPart, listRiders(), ride.reach);
  view.dispatchEvent(new Event("headerride"));
}
