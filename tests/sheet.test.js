import { test } from "node:test";
import assert from "node:assert/strict";
import { openSheet, wireSheet } from "../shared/page/sheet.js";
import { listOpenSheets, reopenSheets } from "../shared/page/sheet-reopen.js";
import {
  closeForgottenDialogs,
  keepDialogFor,
  letGoOfGame,
  noteShownEndsSeen,
  noteShownGame,
} from "../shared/page/sheet-memory.js";

/** @typedef {import("../shared/page/sheet.js").SheetKeeper} SheetKeeper */
/** @typedef {import("../shared/page/sheet.js").SheetParts} SheetParts */

/** @type {FakeElement | null} */
let focused = null;

/** @type {(() => void)[]} */
let slidesUnderWay = [];

/**
 * A slide that runs until the test ends it, halfway along whenever it's asked, and rejects its
 * `finished` once cancelled, as a browser's does.
 * @param {FakeElement} element
 * @param {Keyframe[]} keyframes
 */
function createFakeSlide(element, keyframes) {
  /** @type {() => void} */
  let finish = () => {};
  /** @type {(reason: unknown) => void} */
  let abort = () => {};
  const finished = new Promise((resolve, reject) => {
    finish = () => resolve(undefined);
    abort = reject;
  });
  finished.catch(() => {});
  const slide = {
    finished,
    effect: { getComputedTiming: () => ({ progress: 0.5 }) },
    cancel: () => {
      element.animations.delete(slide);
      abort(new Error("AbortError"));
    },
    keyframes,
  };
  element.animations.add(slide);
  slidesUnderWay.push(() => {
    element.animations.delete(slide);
    finish();
  });
  return slide;
}

/** Ends every slide under way, and waits for the sheets to settle. */
async function endSlides() {
  for (const finish of slidesUnderWay.splice(0)) finish();
  await new Promise((resolve) => setTimeout(resolve));
}

// Just enough of an element for sheet.js: its family, attributes, and what it can be asked.
class FakeElement extends EventTarget {
  /** @param {{ id?: string, tag?: string, className?: string }} [options] */
  constructor({ id = "", tag = "div", className = "" } = {}) {
    super();
    this.id = id;
    this.tag = tag;
    this.className = className;
    /** @type {FakeElement[]} */
    this.children = [];
    /** @type {FakeElement | null} */
    this.parentElement = null;
    /** @type {Map<string, string>} */
    this.attributes = new Map();
    this.hidden = false;
    this.inert = false;
    this.tabIndex = 0;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.offsetWidth = 390;
    this.textContent = "";
    this.style = {
      zIndex: "",
      transform: "",
      visibility: "",
      /** @type {Record<string, string>} */
      variables: {},
      /**
       * @param {string} name
       * @param {string} value
       */
      setProperty(name, value) {
        this.variables[name] = value;
      },
    };
    /** @type {Record<string, string>} */
    this.cssVariables = {};
    /** @type {Set<unknown>} */
    this.animations = new Set();
    /** @type {Set<string>} */
    this.classes = new Set();
    this.classList = {
      add: (/** @type {string[]} */ ...names) => names.forEach((name) => this.classes.add(name)),
      remove: (/** @type {string[]} */ ...names) =>
        names.forEach((name) => this.classes.delete(name)),
      contains: (/** @type {string} */ name) => this.classes.has(name),
    };
  }

  /**
   * @template {FakeElement} T
   * @param {T} child
   */
  append(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  /**
   * @param {string} name
   * @param {string} value
   */
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  /** @param {string} name */
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  /** @param {string} name */
  hasAttribute(name) {
    return this.attributes.has(name);
  }

  /** @param {string} name */
  removeAttribute(name) {
    if (name === "id") this.id = "";
    this.attributes.delete(name);
  }

  /** @param {FakeElement} sibling */
  before(sibling) {
    const parent = /** @type {FakeElement} */ (this.parentElement);
    sibling.parentElement = parent;
    parent.children.splice(parent.children.indexOf(this), 0, sibling);
  }

  remove() {
    const parent = this.parentElement;
    if (parent) parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
  }

  /**
   * A copy as a browser makes one: everything but where it's scrolled, what it's listening for,
   * and what it's animating.
   * @param {boolean} isDeep
   * @returns {FakeElement}
   */
  cloneNode(isDeep) {
    const copy = new FakeElement({ id: this.id, tag: this.tag, className: this.className });
    copy.attributes = new Map(this.attributes);
    Object.assign(copy, { hidden: this.hidden, inert: this.inert, textContent: this.textContent });
    copy.style = { ...this.style };
    copy.classes = new Set(this.classes);
    if (isDeep) for (const child of this.children) copy.append(child.cloneNode(true));
    return copy;
  }

  /** @param {string} selector "*", or attributes as "[id], [data-x]" */
  querySelectorAll(selector) {
    const names = selector === "*" ? null : selector.split(", ").map((each) => each.slice(1, -1));
    /** @param {FakeElement} element */
    const isWanted = (element) =>
      !names || names.some((name) => (name === "id" ? !!element.id : element.hasAttribute(name)));
    /** @type {FakeElement[]} */
    const found = [];
    /** @param {FakeElement} element */
    const visit = (element) => {
      for (const child of element.children) {
        if (isWanted(child)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  /** @param {string} selector "dialog" or one class */
  matches(selector) {
    return selector === this.tag || selector === `.${this.className}`;
  }

  /** @param {string} selector */
  closest(selector) {
    for (let element = /** @type {FakeElement | null} */ (this); element;) {
      if (element.matches(selector)) return element;
      element = element.parentElement;
    }
    return null;
  }

  /**
   * @param {string} selector ":scope > .x" for a child, or ".x" for any element inside
   * @returns {FakeElement | null}
   */
  querySelector(selector) {
    const isOwn = selector.startsWith(":scope > ");
    const wanted = isOwn ? selector.slice(":scope > ".length) : selector;
    for (const child of this.children) {
      if (child.matches(wanted)) return child;
      const found = isOwn ? null : child.querySelector(wanted);
      if (found) return found;
    }
    return null;
  }

  /** @param {FakeElement | null} other */
  contains(other) {
    for (let element = other; element; element = element.parentElement)
      if (element === this) return true;
    return false;
  }

  focus() {
    focused = this;
  }

  // A fake draws nothing, so everything sits at the top left.
  getBoundingClientRect() {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }

  /** @param {Keyframe[]} keyframes */
  animate(keyframes) {
    return createFakeSlide(this, keyframes);
  }
}

class FakeDialog extends FakeElement {
  /** @param {string} id */
  constructor(id) {
    super({ id, tag: "dialog" });
    this.open = false;
    this.timesShown = 0;
  }

  showModal() {
    this.open = true;
    this.timesShown += 1;
  }

  close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  }
}

function createBackButton() {
  const button = new FakeElement({ className: "sheet-back" });
  button.append(new FakeElement({ className: "sheet-back-label" }));
  return button;
}

/** @param {FakeElement} button */
function readBackLabel(button) {
  if (button.hidden) return null;
  return { text: button.children[0].textContent, ariaLabel: button.getAttribute("aria-label") };
}

/**
 * @param {FakeElement} root
 * @param {string} id
 * @returns {FakeElement | null}
 */
function findById(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

const LEFT_AT = Date.parse("2026-10-11T23:00:00Z");
const MINUTE_MS = 60 * 1000;
const SHEET_KEPT_MS = 6 * 60 * MINUTE_MS;
const GAME_KEPT_AFTER_END_MS = 60 * MINUTE_MS;

// The row of sheets leaves this gap between two side by side, as an app's --sheet-gap does.
const GAP = "15px";

/**
 * A dialog with a row of sheets, each with a close and a back button, on a wide screen, where a
 * dialog closes at once instead of sliding down, and sheets settle at once unless `isMoving`.
 * @param {string[]} ids
 * @param {Record<string, Partial<SheetParts>>} [partsById]
 * @param {{ isMoving?: boolean }} [options]
 */
function createRowDialog(ids, partsById = {}, { isMoving = false } = {}) {
  globalThis.matchMedia = /** @type {any} */ (
    (query) => ({ matches: query.includes("reduced-motion") && !isMoving })
  );
  const dialog = new FakeDialog("sheetDialog");
  globalThis.document = /** @type {any} */ ({
    get activeElement() {
      return focused;
    },
    getElementById: (/** @type {string} */ id) => findById(dialog, id),
  });
  globalThis.getComputedStyle = /** @type {any} */ (
    (/** @type {FakeElement} */ element) => ({
      getPropertyValue: (/** @type {string} */ name) => element.cssVariables[name] ?? "",
    })
  );
  const row = dialog.append(new FakeElement({ className: "sheet-row" }));
  row.cssVariables["--panel-gap"] = GAP;
  /** @typedef {{ sheet: FakeElement, body: FakeElement, closeButton: FakeElement, backButton: FakeElement }} FakeSheet */
  const sheets = /** @type {Record<string, FakeSheet>} */ (
    Object.fromEntries(
      ids.map((id) => {
        const sheet = row.append(new FakeElement({ id, tag: "section", className: "sheet-page" }));
        sheet.hidden = true;
        sheet.setAttribute("aria-labelledby", `${id}Title`);
        const backButton = sheet.append(createBackButton());
        const body = sheet.append(new FakeElement({ id: `${id}Body` }));
        body.setAttribute("data-last-drawn", "");
        const parts = { closeButton: new FakeElement(), backButton, ...partsById[id] };
        wireSheet(/** @type {any} */ (sheet), /** @type {any} */ (parts));
        return [id, { sheet, body, ...parts }];
      }),
    )
  );
  return { dialog, row, sheets };
}

/** @param {EventTarget} target */
const click = (target) => target.dispatchEvent(new Event("click"));

/**
 * A sheet's id, or "copy" for a copy of one, which has none.
 * @param {FakeElement} sheet
 */
const nameFake = (sheet) => sheet.id || "copy";

/** @param {FakeElement} row */
const listInRow = (row) => row.children.filter((sheet) => !sheet.hidden).map(nameFake);

/** @param {FakeElement} row */
const findReachable = (row) => {
  const reachable = row.children.find((sheet) => !sheet.hidden && !sheet.inert);
  return reachable && nameFake(reachable);
};

/** @param {FakeElement} row */
const findCopy = (row) => /** @type {FakeElement} */ (row.children.find((sheet) => !sheet.id));

/** @param {FakeElement} row */
const readPlaces = (row) =>
  Object.fromEntries(
    row.children
      .filter((sheet) => !sheet.hidden)
      .map((sheet) => [
        nameFake(sheet),
        { zIndex: sheet.style.zIndex, transform: sheet.style.transform },
      ]),
  );

/**
 * A sheet's code that shows what it's handed, or can't.
 * @param {unknown} shown
 * @param {(subject: any) => boolean} [reopen]
 */
const keepShown = (shown, reopen = () => true) => ({ read: () => shown, reopen });

/** @param {FakeElement} sheet */
const open = (sheet) => openSheet(/** @type {any} */ (sheet));

/**
 * A sheet's code that shows what it's opened to show, as `{ key }`, and lists each opening it
 * draws and each subject it shows again.
 */
function createShowing() {
  /** @type {unknown} */
  let shown = null;
  /** @type {string[]} */
  const drawn = [];
  /** @type {unknown[]} */
  const reopened = [];
  /** @type {SheetKeeper} */
  const keeper = {
    read: () => shown,
    reopen: (subject) => {
      shown = subject;
      reopened.push(subject);
      return true;
    },
  };
  /**
   * @param {FakeElement} sheet
   * @param {string} key
   */
  const openShowing = (sheet, key) =>
    openSheet(/** @type {any} */ (sheet), {
      key,
      show: () => {
        shown = { key };
        drawn.push(key);
      },
    });
  return { keeper, drawn, reopened, open: openShowing };
}

/**
 * A row of a game's sheet and a team's, each showing what it's opened to show.
 * @param {{ isMoving?: boolean }} [options]
 */
function createShowingRow(options) {
  const game = createShowing();
  const team = createShowing();
  /** @type {string[]} */
  const forgotten = [];
  const { dialog, row, sheets } = createRowDialog(
    ["gameSheet", "teamSheet"],
    {
      gameSheet: { keeper: game.keeper, name: "Game", forget: () => forgotten.push("game") },
      teamSheet: { keeper: team.keeper, name: "Team", forget: () => forgotten.push("team") },
    },
    options,
  );
  return {
    dialog,
    row,
    sheets,
    forgotten,
    game,
    team,
    openGame: (/** @type {string} */ key) => game.open(sheets.gameSheet.sheet, key),
    openTeam: (/** @type {string} */ key) => team.open(sheets.teamSheet.sheet, key),
  };
}

const listShowings = () =>
  listOpenSheets().map(({ id, subject, showing }) => ({ id, subject, showing }));

/** @param {any} slide */
const readSlideEnds = (slide) =>
  slide.keyframes.map((/** @type {Keyframe} */ frame) => frame.transform);

test("a sheet opens its dialog with it alone in the row, at its top, and opening it again keeps it open there", () => {
  const { dialog, row, sheets } = createRowDialog(["gameSheet", "teamSheet"]);
  const { sheet } = sheets.gameSheet;

  open(sheet);
  sheet.scrollTop = 300;
  open(sheet);
  assert.equal(dialog.open, true);
  assert.equal(dialog.timesShown, 1);
  assert.equal(sheet.scrollTop, 0);
  assert.deepEqual(listInRow(row), ["gameSheet"]);
  assert.equal(dialog.getAttribute("aria-labelledby"), "gameSheetTitle");
  dialog.close();
});

test("the close button and a click on the backdrop close the dialog, and its sheets leave the row", () => {
  const { dialog, row, sheets } = createRowDialog(["gameSheet"]);

  open(sheets.gameSheet.sheet);
  click(sheets.gameSheet.closeButton);
  assert.equal(dialog.open, false);
  assert.deepEqual(listInRow(row), []);
  open(sheets.gameSheet.sheet);
  click(dialog);
  assert.equal(dialog.open, false);
});

test("a sheet opened from another comes in beside it, the row's gap between them, with a back button that names it, and only the one shown can be reached", () => {
  const { dialog, row, sheets } = createRowDialog(["gameSheet", "teamSheet"], {
    gameSheet: { name: "Game" },
  });

  open(sheets.gameSheet.sheet);
  open(sheets.teamSheet.sheet);

  assert.deepEqual(listInRow(row), ["gameSheet", "teamSheet"]);
  assert.deepEqual(readPlaces(row), {
    gameSheet: { zIndex: "0", transform: "translateX(calc(-100% - 15px))" },
    teamSheet: { zIndex: "1", transform: "" },
  });
  assert.equal(findReachable(row), "teamSheet");
  assert.equal(focused, sheets.teamSheet.sheet);
  assert.equal(dialog.getAttribute("aria-labelledby"), "teamSheetTitle");
  assert.deepEqual(readBackLabel(sheets.teamSheet.backButton), {
    text: "Game",
    ariaLabel: "Back to Game",
  });
  assert.equal(readBackLabel(sheets.gameSheet.backButton), null);
  dialog.close();
});

test("back goes to the sheet before and takes the one it left out of the row, which lets go of what it showed", () => {
  /** @type {string[]} */
  const forgotten = [];
  const { dialog, row, sheets } = createRowDialog(["gameSheet", "teamSheet"], {
    teamSheet: { forget: () => forgotten.push("team") },
  });
  open(sheets.gameSheet.sheet);
  open(sheets.teamSheet.sheet);

  click(sheets.teamSheet.backButton);

  assert.deepEqual(readPlaces(row), { gameSheet: { zIndex: "0", transform: "" } });
  assert.equal(findReachable(row), "gameSheet");
  assert.deepEqual(forgotten, ["team"]);
  dialog.close();
});

test("with motion, a sheet opened from another slides in from the right edge beside it, the one under it going out to the left, the row's gap between them, the row marked as sliding for a tap until the sheet is the one shown and nothing is left moving", async () => {
  const { dialog, row, sheets } = createRowDialog(
    ["gameSheet", "teamSheet"],
    {},
    { isMoving: true },
  );
  open(sheets.gameSheet.sheet);

  open(sheets.teamSheet.sheet);
  const { gameSheet, teamSheet } = sheets;
  assert.deepEqual(
    [gameSheet, teamSheet].map(({ sheet }) => [...sheet.animations].map(readSlideEnds)),
    [[["none", "translateX(calc(-100% - 15px))"]], [["translateX(calc(100% + 15px))", "none"]]],
  );
  assert.deepEqual(readPlaces(row), {
    gameSheet: { zIndex: "0", transform: "translateX(calc(-100% - 15px))" },
    teamSheet: { zIndex: "1", transform: "" },
  });
  assert.equal(gameSheet.sheet.style.visibility, "visible");
  assert.equal(row.getAttribute("data-sliding"), "tap");
  assert.equal(row.style.variables["--sheet-band-joined"], "0px");

  await endSlides();
  assert.equal(findReachable(row), "teamSheet");
  assert.equal(gameSheet.sheet.style.visibility, "");
  assert.equal(row.getAttribute("data-sliding"), null);
  assert.equal(gameSheet.sheet.animations.size + teamSheet.sheet.animations.size, 0);
  dialog.close();
});

test("with motion, a sheet opened while the one over it slides away takes its place, and the one leaving lets go of what it showed", async () => {
  /** @type {string[]} */
  const forgotten = [];
  const { dialog, row, sheets } = createRowDialog(
    ["gameSheet", "teamSheet", "playerSheet"],
    { teamSheet: { forget: () => forgotten.push("team") } },
    { isMoving: true },
  );
  open(sheets.gameSheet.sheet);
  open(sheets.teamSheet.sheet);
  await endSlides();

  click(sheets.teamSheet.backButton);
  open(sheets.playerSheet.sheet);
  assert.equal(sheets.teamSheet.sheet.animations.size, 0);
  await endSlides();

  assert.deepEqual(listInRow(row), ["gameSheet", "playerSheet"]);
  assert.deepEqual(forgotten, ["team"]);
  assert.equal(findReachable(row), "playerSheet");
  dialog.close();
});

test("with motion, a sheet opened again while it slides away stays, and slides back in from where it got to", async () => {
  /** @type {string[]} */
  const forgotten = [];
  const { dialog, row, sheets } = createRowDialog(
    ["gameSheet", "teamSheet"],
    { teamSheet: { forget: () => forgotten.push("team") } },
    { isMoving: true },
  );
  open(sheets.gameSheet.sheet);
  open(sheets.teamSheet.sheet);
  await endSlides();

  click(sheets.teamSheet.backButton);
  open(sheets.teamSheet.sheet);
  assert.deepEqual([...sheets.teamSheet.sheet.animations].map(readSlideEnds), [
    ["translateX(calc(50% + 7.5px))", "none"],
  ]);
  await endSlides();

  assert.deepEqual(listInRow(row), ["gameSheet", "teamSheet"]);
  assert.deepEqual(forgotten, []);
  assert.equal(findReachable(row), "teamSheet");
  dialog.close();
});

test("with motion, a slide whose animations are cancelled still settles", async () => {
  const { dialog, row, sheets } = createRowDialog(
    ["gameSheet", "teamSheet"],
    {},
    { isMoving: true },
  );
  open(sheets.gameSheet.sheet);
  open(sheets.teamSheet.sheet);

  for (const { sheet } of [sheets.gameSheet, sheets.teamSheet])
    for (const slide of /** @type {{ cancel: () => void }[]} */ ([...sheet.animations]))
      slide.cancel();
  slidesUnderWay = [];
  await new Promise((resolve) => setTimeout(resolve));

  assert.equal(findReachable(row), "teamSheet");
  assert.equal(sheets.gameSheet.sheet.style.visibility, "");
  dialog.close();
});

test("a sheet the stack holds, opened to show something else, comes in over the shown one and leaves a copy of what it showed in its place", () => {
  const { dialog, row, sheets, openGame, openTeam } = createShowingRow();
  openTeam("NYL");
  openGame("game-1");
  openTeam("LVA");

  assert.deepEqual(readPlaces(row), {
    copy: { zIndex: "0", transform: "translateX(calc(-100% - 15px))" },
    gameSheet: { zIndex: "1", transform: "translateX(calc(-100% - 15px))" },
    teamSheet: { zIndex: "2", transform: "" },
  });
  assert.equal(findReachable(row), "teamSheet");
  assert.deepEqual(readBackLabel(sheets.teamSheet.backButton), {
    text: "Game",
    ariaLabel: "Back to Game",
  });
  assert.equal(readBackLabel(sheets.gameSheet.backButton)?.text, "Team");
  assert.deepEqual(listShowings(), [
    { id: "teamSheet", subject: { key: "NYL" }, showing: "NYL" },
    { id: "gameSheet", subject: { key: "game-1" }, showing: "game-1" },
    { id: "teamSheet", subject: { key: "LVA" }, showing: "LVA" },
  ]);
  dialog.close();
});

test("a copy holds none of its sheet's ids, nor any part the page draws whole, and is scrolled where its sheet was", () => {
  const { dialog, row, sheets, openGame, openTeam } = createShowingRow();
  openTeam("NYL");
  sheets.teamSheet.sheet.scrollTop = 120;
  sheets.teamSheet.body.scrollLeft = 40;
  openGame("game-1");
  openTeam("LVA");

  const copy = findCopy(row);
  assert.deepEqual(copy.querySelectorAll("[id], [data-last-drawn]"), []);
  assert.equal(copy.scrollTop, 120);
  assert.equal(copy.children[1].scrollLeft, 40);
  assert.equal(readBackLabel(copy.children[0]), null);
  assert.equal(sheets.teamSheet.sheet.scrollTop, 0);
  assert.equal(globalThis.document.getElementById("teamSheetBody"), sheets.teamSheet.body);
  dialog.close();
});

test("back to a copy has its sheet show again what the copy showed, scrolled where it was, and lets the copy go", () => {
  const { dialog, row, sheets, forgotten, team, openGame, openTeam } = createShowingRow();
  openTeam("NYL");
  sheets.teamSheet.sheet.scrollTop = 120;
  sheets.teamSheet.body.scrollLeft = 40;
  openGame("game-1");
  openTeam("LVA");

  click(sheets.teamSheet.backButton);
  assert.deepEqual(listInRow(row), ["gameSheet", "copy"]);
  click(sheets.gameSheet.backButton);

  assert.deepEqual(forgotten, ["team", "game"]);
  assert.deepEqual(team.reopened, [{ key: "NYL" }]);
  assert.equal(row.children.length, 2);
  assert.deepEqual(readPlaces(row), { teamSheet: { zIndex: "0", transform: "" } });
  assert.equal(findReachable(row), "teamSheet");
  assert.equal(focused, sheets.teamSheet.sheet);
  assert.equal(readBackLabel(sheets.teamSheet.backButton), null);
  assert.equal(sheets.teamSheet.sheet.scrollTop, 120);
  assert.equal(sheets.teamSheet.body.scrollLeft, 40);
  assert.deepEqual(listShowings(), [{ id: "teamSheet", subject: { key: "NYL" }, showing: "NYL" }]);
  dialog.close();
});

test("a tap on what the sheet under the shown one shows goes back to it, as it was", () => {
  const { dialog, row, sheets, team, openGame, openTeam } = createShowingRow();
  openTeam("NYL");
  sheets.teamSheet.sheet.scrollTop = 120;
  openGame("game-1");
  openTeam("NYL");

  assert.deepEqual(team.drawn, ["NYL"]);
  assert.equal(row.children.length, 2);
  assert.deepEqual(listInRow(row), ["teamSheet"]);
  assert.equal(findReachable(row), "teamSheet");
  assert.equal(sheets.teamSheet.sheet.scrollTop, 120);
  dialog.close();
});

test("a sheet opened again from itself to show something else comes in over itself, and back shows what it showed", () => {
  const { dialog, row, sheets, team, openTeam } = createShowingRow();
  openTeam("NYL");
  openTeam("NYL");
  assert.equal(row.children.length, 2);

  openTeam("LVA");
  assert.deepEqual(readPlaces(row), {
    copy: { zIndex: "0", transform: "translateX(calc(-100% - 15px))" },
    teamSheet: { zIndex: "1", transform: "" },
  });
  assert.equal(readBackLabel(sheets.teamSheet.backButton)?.text, "Team");

  click(sheets.teamSheet.backButton);
  assert.deepEqual(team.drawn, ["NYL", "NYL", "LVA"]);
  assert.deepEqual(team.reopened, [{ key: "NYL" }]);
  assert.deepEqual(listInRow(row), ["teamSheet"]);
  dialog.close();
});

test("closing the dialog takes every copy out of the row", () => {
  const { dialog, row, openGame, openTeam } = createShowingRow();
  openTeam("NYL");
  openGame("game-1");
  openTeam("LVA");
  openGame("game-2");

  dialog.close();
  assert.deepEqual(row.children.map(nameFake), ["gameSheet", "teamSheet"]);
  assert.deepEqual(listInRow(row), []);
});

test("with motion, a sheet that leaves a copy slides in from the right edge, and its copy waits past the left edge with the one under it", async () => {
  const { dialog, row, sheets, openGame, openTeam } = createShowingRow({ isMoving: true });
  openTeam("NYL");
  openGame("game-1");
  await endSlides();

  openTeam("LVA");
  assert.deepEqual(
    [findCopy(row), sheets.gameSheet.sheet, sheets.teamSheet.sheet].map((sheet) =>
      [...sheet.animations].map(readSlideEnds),
    ),
    [
      [["translateX(calc(-100% - 15px))", "translateX(calc(-100% - 15px))"]],
      [["none", "translateX(calc(-100% - 15px))"]],
      [["translateX(calc(100% + 15px))", "none"]],
    ],
  );
  await endSlides();
  assert.equal(findReachable(row), "teamSheet");
  dialog.close();
});

// A stand-in for settings on a phone, a dialog that is its own sheet, which a swipe down moves and
// closes, with any of `parts` beside its close button.
/** @param {Partial<SheetParts>} [parts] */
function createPhoneSheet(parts = {}) {
  globalThis.matchMedia = /** @type {any} */ ((query) => ({ matches: query.includes("width") }));
  globalThis.document = /** @type {any} */ ({ activeElement: null });
  /** @type {KeyframeAnimationOptions[]} */
  const motions = [];
  const dialog = Object.assign(new FakeDialog("settingsDialog"), {
    getAnimations: () => [],
    /**
     * @param {Keyframe[]} _keyframes
     * @param {KeyframeAnimationOptions} options
     */
    animate(_keyframes, options) {
      motions.push(options);
      /** @type {{ cancel: () => void, finished?: Promise<unknown> }} */
      const motion = { cancel() {} };
      motion.finished = Promise.resolve(motion);
      return motion;
    },
  });
  wireSheet(/** @type {any} */ (dialog), {
    closeButton: /** @type {any} */ (new EventTarget()),
    ...parts,
  });
  open(dialog);
  /**
   * @param {string} type
   * @param {number} [clientY]
   */
  const touch = (type, clientY) => {
    const touches = clientY === undefined ? [] : [{ clientX: 0, clientY }];
    dialog.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { touches }));
  };
  return { dialog, touch, motions };
}

test("on a phone, a swipe down that scrolls the sheet back to its top goes on to move the sheet and close it, at the pace and easing of the phone's own sheets", async () => {
  const { dialog, touch, motions } = createPhoneSheet();
  dialog.scrollTop = 300;

  touch("touchstart", 100);
  touch("touchmove", 200);
  assert.equal(dialog.style.transform, "");
  dialog.scrollTop = 0;
  touch("touchmove", 230);
  assert.equal(dialog.style.transform, "translateY(30px)");
  touch("touchmove", 400);
  touch("touchend");
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(dialog.open, false);
  assert.deepEqual(
    motions.map(({ duration, easing }) => ({ duration, easing })),
    [{ duration: 500, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }],
  );
});

test("on a phone, a swipe down a sheet's section scrolled down scrolls the section, and moves the sheet only once the section is at its top", () => {
  const section = new FakeElement();
  section.scrollTop = 300;
  const { dialog, touch } = createPhoneSheet({ findScroller: () => /** @type {any} */ (section) });

  touch("touchstart", 100);
  touch("touchmove", 200);
  assert.equal(dialog.style.transform, "");
  section.scrollTop = 0;
  touch("touchmove", 230);
  assert.equal(dialog.style.transform, "translateY(30px)");
  dialog.close();
});

test("on a phone, a swipe at the sheet's top that goes up first moves the sheet from its highest point", () => {
  const { dialog, touch } = createPhoneSheet();

  touch("touchstart", 300);
  touch("touchmove", 260);
  assert.equal(dialog.style.transform, "");
  touch("touchmove", 310);
  assert.equal(dialog.style.transform, "translateY(50px)");
  dialog.close();
});

test("the sheets showing are listed up to the shown one, with where each is scrolled, what each shows, and what its back button calls the one before", () => {
  const { dialog, sheets } = createRowDialog(["gameSheet", "teamSheet", "playerSheet"], {
    gameSheet: { keeper: keepShown({ id: "game-1" }), name: "Game" },
    teamSheet: { keeper: keepShown({ team: "NY" }), name: "Team" },
  });
  open(sheets.gameSheet.sheet);
  open(sheets.teamSheet.sheet);
  open(sheets.playerSheet.sheet);
  click(sheets.playerSheet.backButton);
  sheets.gameSheet.sheet.scrollTop = 240;

  assert.deepEqual(listOpenSheets(LEFT_AT), [
    {
      id: "gameSheet",
      scrollTop: 240,
      section: null,
      subject: { id: "game-1" },
      showing: null,
      backLabel: null,
      heldGame: null,
      forgetAt: LEFT_AT + SHEET_KEPT_MS,
    },
    {
      id: "teamSheet",
      scrollTop: 0,
      section: null,
      subject: { team: "NY" },
      showing: null,
      backLabel: "Game",
      heldGame: null,
      forgetAt: LEFT_AT + SHEET_KEPT_MS,
    },
  ]);

  dialog.close();
  assert.deepEqual(listOpenSheets(), []);
});

test("a page that loads again puts back each sheet it showed, up to the first that can't show what it did, and closes a dialog none of whose sheets can", () => {
  /** @type {unknown[]} */
  const reopened = [];
  const { dialog, row } = createRowDialog(["gameSheet", "teamSheet", "playerSheet"], {
    gameSheet: { keeper: keepShown(null, (subject) => reopened.push(subject) > 0) },
    teamSheet: { keeper: keepShown(null, () => false) },
    playerSheet: { keeper: keepShown(null) },
  });
  dialog.open = true;
  dialog.setAttribute("data-reopened", "");

  reopenSheets([
    { id: "gameSheet", scrollTop: 120, subject: { id: "game-1" } },
    { id: "teamSheet", scrollTop: 0, subject: { team: "NY" } },
    { id: "playerSheet", scrollTop: 0, subject: { team: "NY" } },
    { id: "goneSheet", scrollTop: 0, subject: null },
    null,
  ]);

  assert.deepEqual(reopened, [{ id: "game-1" }]);
  assert.equal(dialog.open, true);
  assert.deepEqual(listInRow(row), ["gameSheet"]);
  assert.equal(findReachable(row), "gameSheet");
  assert.deepEqual(
    listOpenSheets().map(({ id }) => id),
    ["gameSheet"],
  );
  dialog.close();
  assert.ok(!dialog.hasAttribute("data-reopened"));

  dialog.open = true;
  reopenSheets([{ id: "teamSheet", scrollTop: 0, subject: { team: "NY" } }]);
  assert.equal(dialog.open, false);
});

test("a page that loads again puts back a sheet over the one it was opened from, and shows it", () => {
  const { dialog, row, sheets } = createRowDialog(["gameSheet", "teamSheet"], {
    gameSheet: { keeper: keepShown(null), name: "Game" },
    teamSheet: { keeper: keepShown(null) },
  });
  dialog.open = true;

  reopenSheets([
    { id: "gameSheet", scrollTop: 0, subject: null },
    { id: "teamSheet", scrollTop: 0, subject: null },
  ]);

  assert.deepEqual(readPlaces(row), {
    gameSheet: { zIndex: "0", transform: "translateX(calc(-100% - 15px))" },
    teamSheet: { zIndex: "1", transform: "" },
  });
  assert.equal(findReachable(row), "teamSheet");
  assert.equal(readBackLabel(sheets.teamSheet.backButton)?.text, "Game");
  dialog.close();
});

test("a page that loads again puts back a sheet the stack held twice, with a copy of what it showed first, and a tap on that goes back to it", () => {
  const { dialog, row, sheets, team, openTeam } = createShowingRow();
  dialog.open = true;
  const saved = [
    { id: "teamSheet", scrollTop: 120, subject: { key: "NYL" }, showing: "NYL" },
    { id: "gameSheet", scrollTop: 0, subject: { key: "game-1" }, showing: "game-1" },
    { id: "teamSheet", scrollTop: 30, subject: { key: "LVA" }, showing: "LVA" },
  ];

  reopenSheets(saved);
  assert.deepEqual(team.reopened, [{ key: "NYL" }, { key: "LVA" }]);
  assert.equal(findReachable(row), "teamSheet");
  assert.equal(readBackLabel(findCopy(row).children[0]), null);
  assert.deepEqual(
    listOpenSheets().map(({ id, scrollTop, subject, showing }) => ({
      id,
      scrollTop,
      subject,
      showing,
    })),
    saved,
  );

  click(sheets.teamSheet.backButton);
  openTeam("NYL");
  assert.deepEqual(team.reopened, [{ key: "NYL" }, { key: "LVA" }, { key: "NYL" }]);
  assert.deepEqual(listInRow(row), ["teamSheet"]);
  assert.equal(sheets.teamSheet.sheet.scrollTop, 120);
  dialog.close();
});

test("saved sheets that can't be read leave every dialog as it is", () => {
  const { dialog } = createRowDialog(["gameSheet"]);
  dialog.open = true;

  reopenSheets("{not json");
  reopenSheets({ id: "gameSheet" });
  assert.equal(dialog.open, true);
  assert.deepEqual(listOpenSheets(), []);
});

/**
 * Has the game sheet note the game it draws, as each app's does.
 * @param {FakeElement} sheet
 * @param {{ isPlayingToday?: boolean, isOver?: boolean }} game
 */
const drawGame = (sheet, { isPlayingToday = false, isOver = false }) =>
  noteShownGame(/** @type {any} */ (sheet), { key: "game-1", isPlayingToday, isOver });

/** @param {{ forgetAt: number | null }[]} sheets */
const listForgetTimes = (sheets) => sheets.map(({ forgetAt }) => forgetAt);

test("a sheet left off the screen closes six hours after the page left, and a dialog kept for less, like settings, closes then", () => {
  const { dialog, sheets } = createRowDialog(["gameSheet", "teamSheet"]);
  open(sheets.gameSheet.sheet);
  open(sheets.teamSheet.sheet);
  assert.deepEqual(listForgetTimes(listOpenSheets(LEFT_AT)), [
    LEFT_AT + SHEET_KEPT_MS,
    LEFT_AT + SHEET_KEPT_MS,
  ]);

  keepDialogFor(/** @type {any} */ (dialog), 2 * MINUTE_MS);
  assert.deepEqual(listForgetTimes(listOpenSheets(LEFT_AT)), [
    LEFT_AT + 2 * MINUTE_MS,
    LEFT_AT + 2 * MINUTE_MS,
  ]);
  dialog.close();
});

test("a page coming back closes a dialog left open as long as it stays, and keeps one left for less", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: LEFT_AT + SHEET_KEPT_MS - 1 });
  const { dialog, sheets } = createRowDialog(["gameSheet"]);
  open(sheets.gameSheet.sheet);

  closeForgottenDialogs(LEFT_AT);
  assert.equal(dialog.open, true);

  t.mock.timers.tick(1);
  closeForgottenDialogs(LEFT_AT);
  assert.equal(dialog.open, false);
});

test("a game's sheet showing a game on today stays open off the screen until an hour after its end shows on the screen", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: LEFT_AT });
  const { dialog, sheets } = createRowDialog(["gameSheet"]);
  const sheet = sheets.gameSheet.sheet;
  open(sheet);
  drawGame(sheet, { isPlayingToday: true });
  assert.deepEqual(listForgetTimes(listOpenSheets(LEFT_AT)), [null]);

  t.mock.timers.tick(3 * SHEET_KEPT_MS);
  closeForgottenDialogs(LEFT_AT);
  assert.equal(dialog.open, true);

  drawGame(sheet, { isOver: true });
  const endSeenAt = Date.now();
  t.mock.timers.tick(10 * MINUTE_MS);
  drawGame(sheet, { isOver: true });
  assert.deepEqual(listForgetTimes(listOpenSheets(Date.now())), [
    endSeenAt + GAME_KEPT_AFTER_END_MS,
  ]);

  closeForgottenDialogs(endSeenAt);
  assert.equal(dialog.open, true);
  t.mock.timers.tick(GAME_KEPT_AFTER_END_MS);
  closeForgottenDialogs(endSeenAt);
  assert.equal(dialog.open, false);
});

test("a game's end that came while the page was off the screen counts as seen once it's back", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: LEFT_AT });
  const { dialog, sheets } = createRowDialog(["gameSheet"]);
  const sheet = sheets.gameSheet.sheet;
  open(sheet);
  drawGame(sheet, { isPlayingToday: true });
  Object.assign(globalThis.document, { hidden: true });
  drawGame(sheet, { isOver: true });
  assert.deepEqual(listForgetTimes(listOpenSheets(LEFT_AT)), [null]);

  t.mock.timers.tick(SHEET_KEPT_MS);
  Object.assign(globalThis.document, { hidden: false });
  noteShownEndsSeen(Date.now());

  assert.deepEqual(listForgetTimes(listOpenSheets(Date.now())), [
    Date.now() + GAME_KEPT_AFTER_END_MS,
  ]);
  dialog.close();
});

test("a game's sheet holds only a game it showed on its day or under way, and only while it's on top", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: LEFT_AT + SHEET_KEPT_MS });
  const { dialog, sheets } = createRowDialog(["gameSheet", "teamSheet"]);
  const sheet = sheets.gameSheet.sheet;
  open(sheet);
  drawGame(sheet, { isOver: true });
  assert.deepEqual(listForgetTimes(listOpenSheets(LEFT_AT)), [LEFT_AT + SHEET_KEPT_MS]);

  drawGame(sheet, { isPlayingToday: true });
  open(sheets.teamSheet.sheet);
  assert.deepEqual(listForgetTimes(listOpenSheets(LEFT_AT)), [
    LEFT_AT + SHEET_KEPT_MS,
    LEFT_AT + SHEET_KEPT_MS,
  ]);
  closeForgottenDialogs(LEFT_AT);
  assert.equal(dialog.open, false);
});

test("a game's sheet that closes lets go of its game, so the same game opened again after its end isn't held", () => {
  const { dialog, sheets } = createRowDialog(["gameSheet"], {
    gameSheet: { forget: () => letGoOfGame(/** @type {any} */ (sheets.gameSheet.sheet)) },
  });
  const sheet = sheets.gameSheet.sheet;
  open(sheet);
  drawGame(sheet, { isPlayingToday: true });
  dialog.close();

  open(sheet);
  drawGame(sheet, { isOver: true });
  assert.deepEqual(listForgetTimes(listOpenSheets(LEFT_AT)), [LEFT_AT + SHEET_KEPT_MS]);
  dialog.close();
});

test("a page that loads again has a game's sheet hold its game as it did, its end seen when it was", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: LEFT_AT });
  const { dialog, sheets } = createRowDialog(["gameSheet"], {
    gameSheet: { keeper: keepShown(null) },
  });
  const endSeenAt = LEFT_AT - 30 * MINUTE_MS;
  dialog.open = true;

  reopenSheets([
    {
      id: "gameSheet",
      scrollTop: 0,
      subject: null,
      heldGame: { key: "game-1", isOver: true, endSeenAt },
    },
  ]);
  drawGame(sheets.gameSheet.sheet, { isOver: true });

  assert.deepEqual(listForgetTimes(listOpenSheets(LEFT_AT)), [endSeenAt + GAME_KEPT_AFTER_END_MS]);
  dialog.close();
});
