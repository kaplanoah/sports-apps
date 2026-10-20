import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as waitFor } from "node:timers/promises";
import {
  describePageStep,
  describePhoneLookChange,
  phoneLookLog,
  watchPhoneLook,
} from "../shared/page/phone-look-log.js";
import { useSavedStorage } from "./saved-storage.js";

useSavedStorage(new Map());

/** @type {Map<string, (event: any) => void>} */
const listeners = new Map();
const page = { hidden: false, isFocused: true };
let phoneLook = "light";
const global = /** @type {any} */ (globalThis);
global.readPhoneLook = () => phoneLook;
global.matchMedia = () => ({
  addEventListener: (/** @type {string} */ type, /** @type {any} */ listener) =>
    listeners.set(`look ${type}`, listener),
});
global.document = {
  get hidden() {
    return page.hidden;
  },
  hasFocus: () => page.isFocused,
  documentElement: { dataset: /** @type {{ theme?: string }} */ ({ theme: "light" }) },
  addEventListener: (/** @type {string} */ type, /** @type {any} */ listener) =>
    listeners.set(type, listener),
};
global.addEventListener = (/** @type {string} */ type, /** @type {any} */ listener) =>
  listeners.set(type, listener);

/** @type {string[]} */
const recorded = [];
let isOn = true;
phoneLookLog.watchSteps(
  () => isOn,
  () => {},
);
watchPhoneLook((text) => recorded.push(text));

/** @param {string} type */
const fire = (type, event = {}) =>
  /** @type {(event: any) => void} */ (listeners.get(type))({ type, ...event });

const readLogged = () => phoneLookLog.readLines().map((line) => line.text);

test("a change says what the phone reports, what the page reads then and a task later, and how the page stands", () => {
  assert.equal(
    describePhoneLookChange({
      reported: "dark",
      readThen: "dark",
      readLater: "light",
      laterMs: 3.6,
      isHidden: false,
      hasFocus: false,
    }),
    "the phone reports dark; reads dark, then light 4ms later; page shown, not focused",
  );
});

test("each change of the phone's look goes to the log and to the record under way, with the look read a task later", async () => {
  phoneLookLog.forgetLines();
  recorded.length = 0;
  page.isFocused = false;
  phoneLook = "dark";
  fire("look change", { matches: true });
  phoneLook = "light";
  await waitFor(5);

  assert.equal(readLogged().length, 1);
  assert.match(
    readLogged()[0],
    /^the phone reports dark; reads dark, then light \d+ms later; page shown, not focused$/,
  );
  assert.deepEqual(recorded, readLogged());
});

test("a page step says what the page reads of the phone's look and the theme it shows", () => {
  assert.equal(
    describePageStep({ step: "the page came back", phoneLook: "dark", theme: "light" }),
    "the page came back; reads dark, shows light",
  );
  assert.equal(
    describePageStep({ step: "the page got focus", phoneLook: "light", theme: undefined }),
    "the page got focus; reads light, shows no theme",
  );
});

test("the page leaving, coming back, and losing and getting focus are logged among the changes, with the look read and the theme shown then", () => {
  phoneLookLog.forgetLines();
  page.hidden = true;
  fire("visibilitychange");
  phoneLook = "dark";
  page.hidden = false;
  fire("visibilitychange");
  fire("blur");
  global.document.documentElement.dataset.theme = "dark";
  fire("focus");

  assert.deepEqual(readLogged(), [
    "the page left the screen; reads light, shows light",
    "the page came back; reads dark, shows light",
    "the page lost focus; reads dark, shows light",
    "the page got focus; reads dark, shows dark",
  ]);
});

test("nothing is logged while Diagnostics is off", async () => {
  phoneLookLog.forgetLines();
  recorded.length = 0;
  isOn = false;
  fire("look change", { matches: false });
  fire("focus");
  await waitFor(5);
  isOn = true;

  assert.deepEqual(readLogged(), []);
  assert.deepEqual(recorded, []);
});
