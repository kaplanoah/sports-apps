// While Diagnostics is on, each record ends with where each season's list of days (day-strip.js)
// is: how far it's scrolled, the day at its top, where that day sits on the screen, its opacity,
// and what a tap on it would land on, which day its strip has chosen, where that date sits, and the
// day a tap or Today sent it to, and with every animation on the page that hasn't finished. A day
// the phone laid out but didn't draw still names its item.

/** @param {DOMRect} rect */
const describeRect = ({ left, top, width, height }) =>
  `${Math.round(left)},${Math.round(top)} ${Math.round(width)}x${Math.round(height)}`;

/** @param {Element | null} element */
function nameElement(element) {
  if (!element) return "nothing";
  if (element.id) return `#${element.id}`;
  return [element.localName, ...element.classList].join(".");
}

/** @param {DOMRect} rect */
const isOnScreen = ({ left, top, right, bottom }) =>
  right > 0 && bottom > 0 && left < innerWidth && top < innerHeight;

/** @param {Element | null} item */
function describeFirstItem(item) {
  if (!item) return "no items";
  const rect = item.getBoundingClientRect();
  if (!isOnScreen(rect)) return `first item at ${describeRect(rect)}, off the screen`;
  const x = Math.max(0, rect.left) + 1;
  const y = Math.max(0, rect.top) + 1;
  const { opacity } = getComputedStyle(item);
  return `first item at ${describeRect(rect)}, opacity ${opacity}, a tap there lands on ${nameElement(document.elementFromPoint(x, y))}`;
}

/** @param {Animation} animation */
function describeAnimation(animation) {
  const target = /** @type {KeyframeEffect | null} */ (animation.effect)?.target ?? null;
  const time = Math.round(Number(animation.currentTime ?? 0));
  return `${nameElement(target)} ${animation.playState} at ${time}ms`;
}

/**
 * Every animation on the page that plays over time and hasn't finished, as one that never moves on
 * leaves what it moves where it started, like a fade-in at nothing. One a scroll drives, like the
 * season tab's header riding up with its part, moves only as its scroller does.
 */
export function describeAnimations() {
  const unfinished = document
    .getAnimations()
    .filter(
      ({ timeline, playState }) => timeline === document.timeline && playState !== "finished",
    );
  return unfinished.length
    ? `Animations: ${unfinished.map(describeAnimation).join("; ")}`
    : "Animations: none";
}

/** @param {HTMLElement} list */
function findDayAtTop(list) {
  const top = list.getBoundingClientRect().top + 1;
  const days = /** @type {HTMLElement[]} */ ([...list.children]);
  return days.find((day) => day.getBoundingClientRect().bottom > top) ?? null;
}

/**
 * Where the strip's chosen date sits: on the strip, or off its side, and whether its dates are
 * sliding behind the box.
 * @param {HTMLElement | null} strip
 * @param {HTMLElement | null} chosen
 */
function describeStrip(strip, chosen) {
  if (!strip) return "no strip";
  const scrolled = `strip scrolled ${Math.round(strip.scrollLeft)} of ${strip.scrollWidth}`;
  if (strip.classList.contains("is-sliding")) return `${scrolled}, its dates sliding`;
  if (!chosen) return scrolled;
  const box = chosen.getBoundingClientRect();
  const bounds = strip.getBoundingClientRect();
  const isOnStrip = box.left >= bounds.left - 1 && box.right <= bounds.right + 1;
  return `${scrolled}, its box ${isOnStrip ? "on the strip" : `off the strip at ${Math.round(box.left)}`}`;
}

/** @param {HTMLElement} list */
function describeDayList(list) {
  const view = /** @type {HTMLElement | null} */ (list.closest(".day-view"));
  const strip = /** @type {HTMLElement | null} */ (view?.querySelector(".day-strip") ?? null);
  const chosen = /** @type {HTMLElement | null} */ (view?.querySelector(".day-cell.is-chosen"));
  const day = findDayAtTop(list);
  const { heldDay, heldArrived } = view?.dataset ?? {};
  return [
    `${view?.id ?? "day list"} scrolled ${Math.round(list.scrollTop)} of ${list.scrollHeight}, ${list.clientHeight} tall`,
    `strip on ${chosen?.dataset.day ?? "no day"}, ${describeStrip(strip, chosen)}`,
    heldDay && (heldArrived ? `held on ${heldDay}` : `on its way to ${heldDay}`),
    `${day?.dataset.day ?? "no day"} at the top, ${describeFirstItem(day)}`,
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * A line for each season's list of days showing on the screen.
 * @returns {string[]}
 */
export const describeShownDayLists = () =>
  /** @type {HTMLElement[]} */ ([...document.querySelectorAll(".day-list")])
    .filter((list) => list.clientHeight > 0)
    .map(describeDayList);
