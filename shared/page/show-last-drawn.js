// Modules run only once all of them have loaded, and the browser can paint before then, so a page
// left to them would first show empty views. The page saves what each part it draws whole showed
// as it leaves the screen (last-seen.js), with the sheets it showed, and this plain script, loaded
// in the head, puts it back: the page calls showLastDrawn() right after its views, its sheets, and
// openLastTab(), before anything is painted, since a part on a hidden tab can't take back where it
// was scrolled.

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
  const saved = readSaved("lastDrawn");
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

// After two minutes away, a list goes back to where it starts, as the Games view's list does
// (long-away.js), and a part that starts hidden, like the Games view's search, is hidden again.
const START_AFTER_AWAY_MS = 2 * 60 * 1000;

/** @param {unknown} savedAt */
const isLongAwayFrom = (savedAt) => !(Date.now() - Number(savedAt) < START_AFTER_AWAY_MS);

/**
 * @param {Element} part
 * @param {unknown} scrolls
 * @param {unknown} savedAt
 */
function restoreScrolls(part, scrolls, savedAt) {
  if (!Array.isArray(scrolls)) return;
  const isLongAway = isLongAwayFrom(savedAt);
  for (const { path, left, top, startTop } of scrolls) {
    const element = Array.isArray(path) ? findByPath(part, path) : null;
    if (!element) continue;
    element.scrollLeft = Number(left) || 0;
    const isOnStart = isLongAway && startTop !== undefined;
    const shownTop = Number(isOnStart ? startTop : top) || 0;
    element.scrollTop = shownTop;
    if (!(element instanceof HTMLElement)) continue;
    // A list put back on its start day goes to the start day its code finds, which can have moved.
    if (isOnStart) element.dataset.putBackStart = "true";
    // The page around a list can settle a little shorter or taller once its code draws it, which
    // can stop a scroll near the list's end short, so the list's code can take it again.
    else if (shownTop > 0) element.dataset.putBackTop = String(shownTop);
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
 * @param {string} id
 * @param {{ markup: string, hidden: boolean, classes?: unknown, style?: unknown, scrolls?: unknown, holderTop?: unknown, savedAt?: unknown }} part
 */
function showPart(id, { markup, hidden, classes, style, scrolls, holderTop, savedAt }) {
  const element = /** @type {HTMLElement} */ (document.getElementById(id));
  element.innerHTML = markup;
  const isBackToStart = element.hasAttribute("data-start-hidden") && isLongAwayFrom(savedAt);
  element.hidden = hidden === true || isBackToStart;
  if (typeof classes === "string") element.classList.add(...classes.split(" ").filter(Boolean));
  if (typeof style === "string") element.setAttribute("style", keepCustomProperties(style));
  restoreScrolls(element, scrolls, savedAt);
  // A part that scrolls in a holder of its own, like the standings in theirs, goes back to where
  // the holder was scrolled, which its code can take again once it knows the holder's room.
  const holder = element.parentElement;
  if (Number(holderTop) > 0 && holder) {
    holder.scrollTop = Number(holderTop);
    holder.dataset.putBackTop = String(holderTop);
  }
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
  const saved = readSaved("openSheets");
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

// What the page last showed is a drawing of its own, so the note that its views are still empty
// goes with it.
function showLastDrawn() {
  const parts = Object.entries(readLastDrawn()).filter(([id, part]) => isDrawnPart(id, part));
  for (const [id, part] of parts) showPart(id, part);
  if (parts.length) document.getElementById("loadNote")?.remove();
  showLastSheets();
}
