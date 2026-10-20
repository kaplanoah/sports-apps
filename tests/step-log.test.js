import { test } from "node:test";
import assert from "node:assert/strict";
import { createStepLog, nameFile, writeStepsAsText } from "../shared/page/step-log.js";
import { useSavedStorage } from "./saved-storage.js";
import { normalizeSpaces } from "./text.js";
import { checkInTimeZone, EASTERN } from "./time-zone.js";

/** @type {Map<string, string>} */
const stored = new Map();
useSavedStorage(stored);
/** @type {Map<string, (event: Event) => void>} */
const listeners = new Map();
globalThis.document = /** @type {any} */ ({
  addEventListener: (/** @type {string} */ type, /** @type {any} */ listener) =>
    listeners.set(type, listener),
});

/** A stand-in for an element, inside the part when `isInPart`. */
class FakeElement {
  /** @param {{ isInPart: boolean, label?: string }} element */
  constructor({ isInPart, label }) {
    this.isInPart = isInPart;
    this.label = label;
    this.id = "";
    this.localName = "span";
    this.classList = ["cell-name"];
  }
  /** @param {string} selector */
  closest(selector) {
    if (selector === "button, a")
      return this.label ? { getAttribute: () => this.label, textContent: this.label } : null;
    return this.isInPart ? this : null;
  }
}
globalThis.Element = /** @type {any} */ (FakeElement);

const createLog = () =>
  createStepLog({
    key: `log${listeners.size}${Math.random()}`,
    title: "Games list",
    isWatched: (target) => !!target.closest(".day-view"),
  });

test("a step is logged only while Diagnostics is on", () => {
  const log = createLog();
  let isOn = false;
  let logged = 0;
  log.watchSteps(
    () => isOn,
    () => (logged += 1),
  );

  log.noteStep("fly to 2026-09-30");
  assert.deepEqual(log.readLines(), []);
  isOn = true;
  log.noteStep("fly to 2026-09-30");
  assert.deepEqual(
    log.readLines().map((line) => line.text),
    ["fly to 2026-09-30"],
  );
  assert.equal(logged, 1);
  log.forgetLines();
  assert.deepEqual(log.readLines(), []);
});

test("no line holds an address, which holds the page's key, even one kept before: a file goes by its name, and the page by page", () => {
  const page = "https://example-subdomain.workers.dev/k3y/";
  stored.set("addressLog", JSON.stringify([{ at: 1, text: `an error at ${page}:0:0` }]));
  const log = createStepLog({ key: "addressLog", title: "Errors", isWatched: () => false });
  log.watchSteps(
    () => true,
    () => {},
  );

  log.noteStep(`Failed to fetch dynamically imported module: ${page}c9c63e6/js/games-view.js`);
  log.noteStep(`a promise failed: Load failed for ${page}`);

  assert.deepEqual(
    log.readLines().map((line) => line.text),
    [
      "an error at page",
      "Failed to fetch dynamically imported module: games-view.js",
      "a promise failed: Load failed for page",
    ],
  );
  assert.doesNotMatch(stored.get("addressLog") ?? "", /k3y|example-subdomain/);
});

test("a file is named on a phone without URL.canParse, as on iOS 16", (context) => {
  const canParse = /** @type {PropertyDescriptor} */ (
    Object.getOwnPropertyDescriptor(URL, "canParse")
  );
  Reflect.deleteProperty(URL, "canParse");
  context.after(() => Object.defineProperty(URL, "canParse", canParse));
  assert.equal(nameFile("https://example-subdomain.workers.dev/k3y/c9c63e6/js/app.js"), "app.js");
  assert.equal(nameFile("https://example-subdomain.workers.dev/k3y/"), "page");
  assert.equal(nameFile("https://"), "page");
});

test("a touch or click on the log's part is logged with where it landed and on what, and one elsewhere isn't", () => {
  const log = createLog();
  log.watchSteps(
    () => true,
    () => {},
  );
  const noteClick = /** @type {(event: any) => void} */ (listeners.get("click"));

  noteClick({
    type: "click",
    target: new FakeElement({ isInPart: false }),
    clientX: 1,
    clientY: 2,
  });
  noteClick({
    type: "click",
    target: new FakeElement({ isInPart: true, label: "Today" }),
    clientX: 340.4,
    clientY: 120.6,
  });
  noteClick({
    type: "click",
    target: new FakeElement({ isInPart: true }),
    clientX: 20,
    clientY: 30,
  });

  assert.deepEqual(
    log.readLines().map((line) => line.text),
    ["click at 340,121 on Today", "click at 20,30 on span.cell-name"],
  );
});

test("copied lines follow the log's title, each with its time", () =>
  checkInTimeZone(EASTERN, () =>
    assert.equal(
      normalizeSpaces(
        createLog().writeLinesAsText([
          { at: Date.parse("2026-10-06T16:05:09Z"), text: "pulse 2026-10-06" },
        ]),
      ),
      "Games list\n12:05:09 PM pulse 2026-10-06",
    ),
  ));

test("a log says whether it's logging, so its part measures the page only while it is", () => {
  const log = createLog();
  let isOn = false;
  log.watchSteps(
    () => isOn,
    () => {},
  );
  assert.equal(log.isLogging(), false);
  isOn = true;
  assert.equal(log.isLogging(), true);
});

test("a log keeps its last 200 lines, enough for a fling through a few weeks of days", () => {
  const log = createLog();
  log.watchSteps(
    () => true,
    () => {},
  );
  for (let line = 1; line <= 250; line += 1) log.noteStep(`top day ${line}`);
  const lines = log.readLines().map((line) => line.text);
  assert.equal(lines.length, 200);
  assert.equal(lines[0], "top day 51");
  assert.equal(lines.at(-1), "top day 250");
});

test("steps kept elsewhere, like the service worker's, copy under their title the same way, and none copies nothing", () =>
  checkInTimeZone(EASTERN, () => {
    assert.equal(
      normalizeSpaces(
        writeStepsAsText("Service worker", [
          { at: Date.parse("2026-10-14T04:28:41Z"), text: "Opened the page from the copy" },
          { at: Date.parse("2026-10-14T04:28:40Z"), text: "Started" },
        ]),
      ),
      "Service worker\n12:28:41 AM Opened the page from the copy\n12:28:40 AM Started",
    );
    assert.equal(writeStepsAsText("Service worker", []), "");
  }));
