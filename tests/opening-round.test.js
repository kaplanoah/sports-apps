import test from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { readRepoFile } from "./repo-files.js";
import { findOpeningRound, takeKeptScroll, watchOpeningRound } from "#shared/opening-round.js";

const isDecided = (series) => !!series.winner;
const decided = { winner: "A" };
const open = { winner: null };

test("a bracket opens on the earliest round with a series still to finish", () => {
  assert.equal(findOpeningRound([[open, open], [open], [open]], isDecided), 0);
  assert.equal(findOpeningRound([[decided, open], [open], [open]], isDecided), 0);
  assert.equal(findOpeningRound([[decided, decided], [open], [open]], isDecided), 1);
});

test("a finished bracket opens on its last round", () => {
  assert.equal(findOpeningRound([[decided, decided], [decided], [decided]], isDecided), 2);
});

function prepareBracket(t) {
  let onResize;
  let isShown = true;
  const globals = {
    matchMedia: () => ({ matches: true }),
    getComputedStyle: () => ({ scrollPaddingLeft: "0", scrollPaddingRight: "0" }),
    ResizeObserver: class {
      constructor(callback) {
        onResize = callback;
      }
      observe() {}
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
  class Scroller {
    dataset = { startLeft: "300" };
    scrollLeft = 0;
    scrollTop = 0;
    clientWidth = 300;
    scrollWidth = 1200;
    closest() {
      return null;
    }
    getBoundingClientRect() {
      return { left: 0 };
    }
    scrollTo({ left }) {
      this.scrollLeft = left;
    }
  }
  const scroller = /** @type {HTMLElement} */ (/** @type {unknown} */ (new Scroller()));
  const context = createContext({ HTMLElement: Scroller });
  for (const file of ["long-away.js", "show-last-drawn.js"])
    runInContext(readRepoFile(`shared/page/${file}`), context);
  const restore = (left, awayMs, top = 0, partId = "bracketWrap") => {
    const saved = {
      savedAt: 1_000_000 - awayMs,
      scrolls: [{ path: [0], left, top, startLeft: 300 }],
    };
    const place = runInContext("findPlaceToShow", context)(
      saved,
      { isInSheet: false, isStartHidden: false },
      1_000_000,
    );
    runInContext("restoreScrolls", context)({ id: partId, children: [scroller] }, place.scrolls);
  };
  const target = /** @type {HTMLElement} */ ({
    getBoundingClientRect: () => ({
      left: 600 - scroller.scrollLeft,
      right: 850 - scroller.scrollLeft,
    }),
  });
  const wrap = /** @type {HTMLElement} */ (
    /** @type {unknown} */ ({ getClientRects: () => (isShown ? [{}] : []) })
  );
  const draw = watchOpeningRound(wrap);
  const redraw = (round = 2, previous = scroller) => {
    const keptScroll = takeKeptScroll(previous);
    scroller.scrollLeft = 0;
    draw({ scroller, target, round, keptScroll });
  };
  const show = (shown) => {
    isShown = shown;
    onResize();
  };
  return { scroller, restore, redraw, show };
}

for (const left of [0, 240]) {
  test(`a short reload keeps restored left ${left} through the first draw and repeated redraws`, (t) => {
    const { scroller, restore, redraw } = prepareBracket(t);
    restore(left, 60_000);
    assert.equal(scroller.scrollLeft, left);
    redraw();
    assert.equal(scroller.scrollLeft, left);
    assert.equal(scroller.dataset.putBackLeft, undefined);
    scroller.scrollLeft = 120;
    redraw();
    redraw();
    assert.equal(scroller.scrollLeft, 120);
  });
}

for (const isSideways of [false, true]) {
  test(`a restored ${isSideways ? "date strip" : "vertical list"} keeps its position without a bracket restoration marker`, (t) => {
    const { scroller, restore } = prepareBracket(t);
    if (!isSideways) delete scroller.dataset.startLeft;
    const left = isSideways ? 240 : 0;
    restore(left, 60_000, 160, isSideways ? "seasonGames" : "bracketWrap");
    assert.equal(scroller.scrollLeft, left);
    assert.equal(scroller.scrollTop, 160);
    assert.equal(scroller.dataset.putBackTop, "160");
    assert.equal(scroller.dataset.putBackLeft, undefined);
  });
}

test("a fresh bracket opens on the active round", (t) => {
  const { scroller, redraw } = prepareBracket(t);
  redraw(2, null);
  assert.equal(scroller.scrollLeft, 600);
});

test("a long-away bracket opens on the current round rather than its saved round or scroll", (t) => {
  const { scroller, restore, redraw } = prepareBracket(t);
  restore(0, 120_000);
  assert.equal(scroller.scrollLeft, 300);
  redraw();
  assert.equal(scroller.scrollLeft, 600);
  assert.equal(scroller.dataset.putBackStart, undefined);
});

test("a restored bracket follows a round change and opens on the active round after its tab returns", (t) => {
  const { scroller, restore, redraw, show } = prepareBracket(t);
  restore(0, 60_000);
  redraw();
  assert.equal(scroller.scrollLeft, 0);
  redraw(3);
  assert.equal(scroller.scrollLeft, 600);
  scroller.scrollLeft = 120;
  show(false);
  show(true);
  assert.equal(scroller.scrollLeft, 600);
});
