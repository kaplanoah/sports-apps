import { test } from "node:test";
import assert from "node:assert/strict";
import { wireTabs } from "../shared/page/tabs.js";

// Just enough of a tab's button for tabs.js: its tab, whether it's hidden, and its focus.
class FakeTab extends EventTarget {
  /**
   * @param {string} tab
   * @param {{ hidden?: boolean, onFocus: (tab: string) => void }} options
   */
  constructor(tab, { hidden = false, onFocus }) {
    super();
    this.dataset = { tab };
    this.hidden = hidden;
    this.focus = () => onFocus(tab);
  }
}

/**
 * Tabs wired as a page wires them, each `hidden` one hidden, which say what each key selects.
 * @param {string[]} tabs
 * @param {string[]} [hidden]
 */
function wireFakeTabs(tabs, hidden = []) {
  /** @type {string[]} */
  const selected = [];
  /** @type {string[]} */
  const focused = [];
  const buttons = tabs.map(
    (tab) =>
      new FakeTab(tab, { hidden: hidden.includes(tab), onFocus: (each) => focused.push(each) }),
  );
  wireTabs(/** @type {any} */ (buttons), (tab) => selected.push(tab));
  /**
   * @param {string} tab
   * @param {string} key
   */
  const press = (tab, key) =>
    buttons[tabs.indexOf(tab)].dispatchEvent(Object.assign(new Event("keydown"), { key }));
  return { press, selected, focused };
}

test("the arrows step to the tab beside, round from the last to the first, and Home and End go to the ends", () => {
  const { press, selected, focused } = wireFakeTabs(["games", "bracket", "news"]);

  press("games", "ArrowRight");
  press("news", "ArrowRight");
  press("games", "ArrowLeft");
  press("bracket", "End");
  press("bracket", "Home");

  assert.deepEqual(selected, ["bracket", "games", "news", "news", "games"]);
  assert.deepEqual(focused, selected);
});

test("the arrows and Home and End pass over a hidden tab", () => {
  const { press, selected } = wireFakeTabs(["team", "roster", "playoffs"], ["playoffs"]);

  press("team", "ArrowRight");
  press("roster", "ArrowRight");
  press("team", "ArrowLeft");
  press("team", "End");

  assert.deepEqual(selected, ["roster", "team", "roster", "roster"]);
});
