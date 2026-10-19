import { html, setHtml } from "./html.js";

// What rides above a season's pill (season-header.js) is drawn over its parts, so a finger that
// lands on it starts outside the part that scrolls. Most of it lets a touch through to the part's
// empty top (pager.css), but the Updates box is rows a tap opens, so each of its buttons has a
// stand-in in that empty top of each part, right under it: a tap there does what the button does,
// and a finger that moves scrolls the part, as a button inside a list that scrolls does.

const BOX_BUTTONS = "#updates .game-open, #dismissUpdates";

/** The Updates box's buttons that show, in the order their stand-ins are laid. */
const listBoxButtons = () =>
  /** @type {HTMLElement[]} */ ([...document.querySelectorAll(BOX_BUTTONS)]).filter(
    (button) => button.getClientRects().length > 0,
  );

/**
 * The button `element` stands in for, or null for an element that isn't a stand-in.
 * @param {Element} element
 * @returns {HTMLElement | null}
 */
function findButtonStoodFor(element) {
  const index = element instanceof HTMLElement ? element.dataset.standIn : undefined;
  return index === undefined ? null : (listBoxButtons()[Number(index)] ?? null);
}

/**
 * Whether `element` is a stand-in, whose press its button hears as its own (`passPress`).
 * @param {EventTarget | null} element
 */
export const isStandIn = (element) =>
  element instanceof HTMLElement && element.classList.contains("rider-tap");

/** @typedef {{ top: number, left: number, width: number, height: number }} Box */

/**
 * Where a stand-in sits in a part: under its button, from where the button and the pill are on the
 * screen, which ride alike, where the pill starts down the part, and where the part starts across
 * the screen.
 * @param {Box} button
 * @param {Box} pill
 * @param {number} pillTop
 * @param {number} partLeft
 * @returns {Box}
 */
export const placeStandIn = (button, pill, pillTop, partLeft) => ({
  top: button.top - pill.top + pillTop,
  left: button.left - partLeft,
  width: button.width,
  height: button.height,
});

/** @param {HTMLElement} view */
const listTapHolders = (view) =>
  /** @type {HTMLElement[]} */ ([...view.querySelectorAll(".rider-taps")]);

/**
 * @param {HTMLElement} tap
 * @param {Box} place
 */
function placeTap(tap, place) {
  for (const [side, pixels] of Object.entries(place)) tap.style.setProperty(side, `${pixels}px`);
}

/**
 * @param {HTMLElement} taps
 * @param {Box[]} places
 */
function drawStandIns(taps, places) {
  setHtml(
    taps,
    html`${places.map((_, index) => html`<button type="button" class="rider-tap" tabindex="-1" data-stand-in="${index}"></button>`)}`,
  );
  const tapButtons = /** @type {HTMLElement[]} */ ([...taps.children]);
  tapButtons.forEach((tap, index) => placeTap(tap, places[index]));
}

/**
 * Lays a stand-in under each of the Updates box's buttons in each of the view's parts, while the
 * header rides, and none otherwise.
 * @param {HTMLElement} view
 * @param {HTMLElement} pill
 */
function placeRiderTaps(view, pill) {
  const buttons = view.hasAttribute("data-follows") ? listBoxButtons() : [];
  const pillBox = pill.getBoundingClientRect();
  const pillTop = parseFloat(view.style.getPropertyValue("--parts-top")) - pill.offsetHeight;
  // Every part fills the row that holds them, which holds still while slide-panels.js moves a part
  // aside, so the row's left edge is where each part starts at rest.
  const partsRow = /** @type {HTMLElement} */ (view.querySelector(".season-parts"));
  const partLeft = partsRow.getBoundingClientRect().left;
  const places = buttons.map((button) =>
    placeStandIn(button.getBoundingClientRect(), pillBox, pillTop, partLeft),
  );
  for (const taps of listTapHolders(view)) drawStandIns(taps, places);
}

/** @param {Event} event */
const findTapped = (event) => findButtonStoodFor(/** @type {Element} */ (event.target));

// The button a stand-in stands in for hears the stand-in's press as its own, so it readies what it
// opens as a finger lands, as a game's row does.
/** @param {PointerEvent} event */
function passPress(event) {
  const button = findTapped(event);
  if (!button) return;
  const { pointerId, pointerType, isPrimary, clientX, clientY } = event;
  button.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: event.button,
      pointerId,
      pointerType,
      isPrimary,
      clientX,
      clientY,
    }),
  );
}

/** @param {MouseEvent} event */
function passTap(event) {
  findTapped(event)?.click();
}

/**
 * Gives each of the view's parts a place for its stand-ins, has each stand-in pass its taps on,
 * and lays them again whenever the header's ride is measured again, as it is whenever what rides,
 * the Updates box among it, changes size.
 * @param {HTMLElement} view
 * @param {HTMLElement} pill
 * @param {HTMLElement[]} parts
 */
export function startRiderTaps(view, pill, parts) {
  for (const part of parts) {
    const taps = document.createElement("div");
    taps.className = "rider-taps";
    taps.setAttribute("aria-hidden", "true");
    part.append(taps);
    part.addEventListener("pointerdown", passPress);
    part.addEventListener("click", passTap);
  }
  const place = () => placeRiderTaps(view, pill);
  view.addEventListener("headerride", place);
  place();
}
