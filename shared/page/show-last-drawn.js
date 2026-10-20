// Modules run only once all of them have loaded, and the browser can paint before then, so a page
// left to them would first show empty views. The page saves what each part it draws whole showed
// as it leaves the screen (last-seen.js), with the sheets it showed and its settings' switches, and
// this plain script, loaded in the head, puts it back, with the look picked that settings shows:
// the page calls showLastDrawn() right after its views, its sheets, and
// openLastTab(), before anything is painted, since a part on a hidden tab can't take back where it
// was scrolled. After two minutes away, what a viewer moved starts over (long-away.js).

/* global findPlaceToShow, isLongAwayFrom -- from long-away.js */
/* global LAST_DRAWN_KEY -- from open-last-tab.js */
/* global checkPickedChoice, readPickedAppearance -- from pick-theme.js */

// What last-seen.js saves the page's open sheets and settings' switches under.
const OPEN_SHEETS_KEY = "openSheets";
const LAST_SWITCHED_KEY = "lastSwitched";

// Storage can be empty or refuse access, as in a private window, so the page never depends on it.
/** @param {string} key */
function readSaved(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function readLastDrawn() {
  const saved = readSaved(LAST_DRAWN_KEY);
  return saved && typeof saved === "object" ? saved : {};
}

// Only a part the page draws whole goes back, since a release may have changed the markup around
// it, and the page's modules redraw it from the season before it's ever used.
/**
 * @param {string} id
 * @param {any} part
 */
function isDrawnPart(id, part) {
  const element = document.getElementById(id);
  return !!element?.hasAttribute("data-last-drawn") && typeof part?.markup === "string";
}

/**
 * @param {Element} part
 * @param {number[]} path child indexes from the part
 */
function findByPath(part, path) {
  let element = part;
  for (const index of path) element = element?.children[index];
  return element;
}

/**
 * @param {Element} part
 * @param {ReturnType<typeof findPlaceToShow>["scrolls"]} scrolls
 */
function restoreScrolls(part, scrolls) {
  for (const { path, left, top, isOnStart } of scrolls) {
    const element = Array.isArray(path) ? findByPath(part, path) : null;
    if (!element) continue;
    element.scrollLeft = left;
    element.scrollTop = top;
    // A part inside the season's standings or bracket is laid out only once season-header.js
    // places them, right after this, which can widen it past where it could first be scrolled.
    if (left > 0) requestAnimationFrame(() => (element.scrollLeft = left));
    if (!(element instanceof HTMLElement)) continue;
    // A list put back on its start day goes to the start day its code finds, which can have moved.
    if (isOnStart) element.dataset.putBackStart = "true";
    // The page around a list can settle a little shorter or taller once its code draws it, which
    // can stop a scroll near the list's end short, so the list's code can take it again.
    else if (top > 0) element.dataset.putBackTop = String(top);
  }
}

/**
 * Chooses the first of each row of tabs in `part`, as tabs.js chooses one.
 * @param {Element} part
 */
function chooseFirstTabs(part) {
  for (const tabList of part.querySelectorAll("[role=tablist]")) {
    const tabs = /** @type {HTMLElement[]} */ ([...tabList.querySelectorAll("[role=tab]")]);
    tabs.forEach((tab, index) => {
      tab.classList.toggle("active", index === 0);
      tab.setAttribute("aria-selected", String(index === 0));
      tab.tabIndex = index === 0 ? 0 : -1;
    });
  }
}

// A part's style comes back only for the colors its code hands it as custom properties, like a game
// sheet's teams'. The rest was the page's for a moment, like the hold of a pull to refresh that
// reloaded the page, and would stay for good.
/** @param {string} style */
const keepCustomProperties = (style) =>
  style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.startsWith("--"))
    .join("; ");

/**
 * Puts back a part as it showed, or from its start after two minutes away, and says how far the
 * page was scrolled while it showed.
 * @param {string} id
 * @param {{ markup: string, hidden: boolean, style?: unknown, savedAt?: unknown }} part
 * @param {number} now
 */
function showPart(id, part, now) {
  const element = /** @type {HTMLElement} */ (document.getElementById(id));
  const place = findPlaceToShow(part, !!element.closest("dialog"), now);
  element.innerHTML = part.markup;
  const isBackToStart =
    element.hasAttribute("data-start-hidden") && isLongAwayFrom(part.savedAt, now);
  element.hidden = part.hidden === true || isBackToStart;
  element.classList.add(...place.classes.split(" ").filter(Boolean));
  if (typeof part.style === "string")
    element.setAttribute("style", keepCustomProperties(part.style));
  if (place.isOnFirstTab) chooseFirstTabs(element);
  restoreScrolls(element, place.scrolls);
  // A part drawn inside the season's standings or bracket, which each scroll on their own, goes
  // back to where its holder was scrolled, which season-header.js takes again once it knows the
  // holder's room.
  const holder = element.parentElement;
  if (place.holderTop > 0 && holder) {
    holder.scrollTop = place.holderTop;
    holder.dataset.putBackTop = String(place.holderTop);
  }
  return element.closest("section.view.active") ? place.pageTop : 0;
}

/** @param {any} saved */
const isForgotten = (saved) => typeof saved?.forgetAt === "number" && Date.now() >= saved.forgetAt;

/** @param {any} saved */
function findLastSheet(saved) {
  const sheet = typeof saved?.id === "string" ? document.getElementById(saved.id) : null;
  const dialog = sheet?.closest("dialog");
  return sheet && dialog && !dialog.open ? { sheet, dialog } : null;
}

/**
 * Names the sheet a sheet was opened from on its back button, as sheet.js does.
 * @param {HTMLElement} sheet
 * @param {unknown} backLabel
 */
function labelBackButton(sheet, backLabel) {
  const backButton = /** @type {HTMLElement | null} */ (sheet.querySelector(".sheet-back"));
  const label = backButton?.querySelector(".sheet-back-label");
  if (!backButton || !label || typeof backLabel !== "string") return;
  label.textContent = backLabel;
  backButton.setAttribute("aria-label", `Back to ${backLabel}`);
  backButton.hidden = false;
}

/**
 * Shows the section a sheet showed, under the pills it offered, scrolled where it was, as
 * sheet-sections.js shows one: the rest inert, which hides them.
 * @param {HTMLElement} sheet
 * @param {any} section
 */
function showLastSection(sheet, section) {
  const shown = typeof section?.id === "string" ? document.getElementById(section.id) : null;
  const tabList = /** @type {HTMLElement | null} */ (
    sheet.querySelector(".sheet-top [role=tablist]")
  );
  if (!shown || !tabList || !sheet.contains(shown) || !Array.isArray(section.tabs)) return;
  for (const each of sheet.querySelectorAll(".sheet-sections > .sheet-section"))
    /** @type {HTMLElement} */ (each).inert = each !== shown;
  tabList.hidden = section.tabs.length === 0;
  for (const tab of /** @type {NodeListOf<HTMLElement>} */ (
    tabList.querySelectorAll("[role=tab]")
  )) {
    const isShown = tab.getAttribute("aria-controls") === shown.id;
    tab.hidden = !section.tabs.includes(tab.id);
    tab.setAttribute("aria-selected", String(isShown));
    tab.classList.toggle("active", isShown);
  }
  shown.scrollTop = Number(section.top) || 0;
}

/**
 * Puts a dialog's sheets back in its row, one over another in the order they opened, and shows
 * the last of them, as sheet.js places them.
 * @param {HTMLDialogElement} dialog
 * @param {{ sheet: HTMLElement, saved: any }[]} sheets
 */
function showLastDialog(dialog, sheets) {
  const last = sheets.length - 1;
  sheets.forEach(({ sheet, saved }, index) => {
    if (sheet === dialog) return;
    sheet.hidden = false;
    sheet.style.zIndex = String(index);
    sheet.inert = index !== last;
    labelBackButton(sheet, saved.backLabel);
  });
  dialog.setAttribute("data-reopened", "");
  dialog.showModal();
  for (const { sheet, saved } of sheets) {
    sheet.scrollTop = Number(saved.scrollTop) || 0;
    showLastSection(sheet, saved.section);
  }
}

// A sheet that was showing is still there when the page comes back, so it shows without rising
// again, beside any it was opened from, until the page's modules take it over (sheet.js's
// reopenSheets) or close it, unless it was left open longer than it stays (sheet-memory.js).
function showLastSheets() {
  const saved = readSaved(OPEN_SHEETS_KEY);
  if (!Array.isArray(saved)) return;
  /** @type {Map<HTMLDialogElement, { sheet: HTMLElement, saved: any }[]>} */
  const dialogs = new Map();
  for (const each of saved) {
    const found = findLastSheet(each);
    if (found)
      dialogs.set(found.dialog, [
        ...(dialogs.get(found.dialog) ?? []),
        { sheet: found.sheet, saved: each },
      ]);
  }
  for (const [dialog, sheets] of dialogs)
    if (!sheets.some(({ saved }) => isForgotten(saved))) showLastDialog(dialog, sheets);
}

// Settings' switches show the device's own choices, which their modules set only once they load,
// each kept under its own key by its own rules, so the page saves what each showed as it leaves the
// screen, but for one inside a part drawn whole, which that part's markup holds.
const KEPT_SWITCHES = "[data-setting] [role=switch][id]:not([data-last-drawn] *)";

function showLastSwitches() {
  const saved = readSaved(LAST_SWITCHED_KEY);
  if (!saved || typeof saved !== "object") return;
  for (const [id, isOn] of Object.entries(saved)) {
    const element = document.getElementById(id);
    if (element?.matches(KEPT_SWITCHES) && (isOn === "true" || isOn === "false"))
      element.setAttribute("aria-checked", isOn);
  }
}

// The look picked is the one pick-theme.js shows, read from where the page keeps it.
function showPickedAppearance() {
  const choices = /** @type {NodeListOf<HTMLInputElement>} */ (
    document.querySelectorAll("[data-setting] input[name=appearance]")
  );
  checkPickedChoice(choices, readPickedAppearance());
}

// What the page last showed is a drawing of its own, so the note that its views are still empty
// goes with it.
function showLastDrawn() {
  const parts = Object.entries(readLastDrawn()).filter(([id, part]) => isDrawnPart(id, part));
  const now = Date.now();
  const pageTops = parts.map(([id, part]) => showPart(id, part, now));
  if (parts.length) document.getElementById("loadNote")?.remove();
  // The browser's own putting back of the page's scroll would undo a start over, and comes once
  // the page has loaded, after its parts have shown where they were.
  history.scrollRestoration = "manual";
  scrollTo({ top: Math.max(0, ...pageTops), behavior: "instant" });
  showLastSwitches();
  showPickedAppearance();
  showLastSheets();
}
