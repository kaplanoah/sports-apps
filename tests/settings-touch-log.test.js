import { test } from "node:test";
import assert from "node:assert/strict";
import { settingsTouchLog, watchSettingsTouches } from "../shared/page/settings-touch-log.js";
import { useSavedStorage } from "./saved-storage.js";

useSavedStorage(new Map());

/** @typedef {{ listener: (event: any) => void, isCapture: boolean }} Listening */

/**
 * Listeners added to `listeners`, each with whether it hears the capture.
 * @param {Map<string, Listening[]>} listeners
 */
const addListenerTo =
  (listeners) =>
  (
    /** @type {string} */ type,
    /** @type {(event: any) => void} */ listener,
    /** @type {{ capture?: boolean }} */ options = {},
  ) =>
    listeners.set(type, [
      ...(listeners.get(type) ?? []),
      { listener, isCapture: !!options.capture },
    ]);

/** @type {Map<string, Listening[]>} */
const documentListeners = new Map();
/** @type {Map<string, Listening[]>} */
const windowListeners = new Map();
/** @type {FakeElement | null} */
let elementAtPoint = null;
globalThis.document = /** @type {any} */ ({
  addEventListener: addListenerTo(documentListeners),
  elementFromPoint: () => elementAtPoint,
});
globalThis.addEventListener = /** @type {any} */ (addListenerTo(windowListeners));

/** A stand-in for an element, in settings or Contact or elsewhere on the page. */
class FakeElement {
  /**
   * @param {{ id?: string, localName?: string, classes?: string[], isInSettings?: boolean, isInDiagnostics?: boolean, label?: string, files?: { name: string }[] }} element
   *   `label` is a button's aria-label, for an element that's a button
   */
  constructor({
    id = "",
    localName = "div",
    classes = [],
    isInSettings = true,
    isInDiagnostics = false,
    label,
    files,
  }) {
    this.id = id;
    this.localName = localName;
    this.classList = classes;
    this.isInSettings = isInSettings;
    this.isInDiagnostics = isInDiagnostics;
    this.label = label;
    this.files = files;
  }
  /** @param {string} selector */
  closest(selector) {
    if (selector === "button, a") return this.label ? this : null;
    if (selector === "#diagnostics") return this.isInDiagnostics ? this : null;
    return selector === "#settingsDialog, #contactDialog" && this.isInSettings ? this : null;
  }
  getAttribute() {
    return this.label ?? null;
  }
}
globalThis.Element = /** @type {any} */ (FakeElement);

settingsTouchLog.watchSteps(
  () => true,
  () => {},
);
watchSettingsTouches();

const addScreenshot = new FakeElement({ localName: "label", classes: ["contact-secondary"] });
/** @param {{ name: string }[]} [files] */
const makeScreenshotField = (files) =>
  new FakeElement({
    id: "contactScreenshot",
    localName: "input",
    classes: ["contact-file"],
    files,
  });
const screenshotField = makeScreenshotField();
const settingsBody = new FakeElement({ classes: ["settings-body"] });

/**
 * Sends an event as the browser does, through the window's and the document's capture to the
 * window's bubble, with what the page's code did to it.
 * @param {string} type
 * @param {{ target: FakeElement, points?: { x: number, y: number }[], endPoint?: { x: number, y: number }, defaultPrevented?: boolean, isStopped?: boolean, isPrimary?: boolean }} event
 *   `points` are the fingers down, `endPoint` where a finger lifted, and `isStopped` whether the
 *   page's code stopped the event once the window's capture heard it, as press.js does
 */
function sendEvent(
  type,
  { target, points = [], endPoint, defaultPrevented = false, isStopped = false, isPrimary = true },
) {
  const toTouch = ({ x, y }) => ({ clientX: x, clientY: y });
  const event = {
    type,
    target,
    touches: points.map(toTouch),
    changedTouches: endPoint ? [toTouch(endPoint)] : points.map(toTouch),
    defaultPrevented: false,
    isPrimary,
  };
  const hear = (/** @type {Listening[] | undefined} */ listening, isCapture) => {
    for (const heard of listening ?? []) if (heard.isCapture === isCapture) heard.listener(event);
  };
  hear(windowListeners.get(type), true);
  event.defaultPrevented = defaultPrevented;
  if (isStopped) return;
  hear(documentListeners.get(type), true);
  hear(windowListeners.get(type), false);
}

/** Waits for the clicks sent so far to end their dispatch. */
const waitForDispatch = () => new Promise((resolve) => setTimeout(resolve));

/** The log's lines from the events `sendEvents` sends, once their clicks' dispatch ends. */
async function readLinesFrom(/** @type {() => void | Promise<void>} */ sendEvents) {
  settingsTouchLog.forgetLines();
  await sendEvents();
  await waitForDispatch();
  return settingsTouchLog.readLines().map((line) => line.text);
}

test("a tap on Add screenshot logs its touch, that nothing took it, what it ended over, its click, the field's click, and the file the field got, without the file's name", async () => {
  elementAtPoint = addScreenshot;
  const field = makeScreenshotField([{ name: "IMG_0412.PNG" }]);
  const lines = await readLinesFrom(async () => {
    sendEvent("touchstart", { target: addScreenshot, points: [{ x: 120, y: 610 }] });
    sendEvent("touchend", { target: addScreenshot, endPoint: { x: 120, y: 610 } });
    sendEvent("click", { target: addScreenshot });
    sendEvent("click", { target: screenshotField });
    await waitForDispatch();
    sendEvent("change", { target: field });
  });
  assert.deepEqual(lines, [
    "touchstart at 120,610 on label.contact-secondary",
    "touchend at 120,610 on label.contact-secondary",
    "lifted without moving; neither the page's code nor the browser took the touch; the page's code left its end; its pointer wasn't cancelled; nothing scrolled; it ended over label.contact-secondary",
    "click on label.contact-secondary",
    "click on #contactScreenshot",
    "the click on label.contact-secondary reached the window untaken",
    "the click on #contactScreenshot reached the window untaken",
    "the screenshot field changed with a file chosen",
  ]);
  assert.ok(lines.every((line) => !line.includes("IMG_0412")));
});

test("a touch the browser took for a scroll says so, and a click the page's code then stopped logs as stopped", async () => {
  elementAtPoint = settingsBody;
  const lines = await readLinesFrom(() => {
    sendEvent("touchstart", { target: addScreenshot, points: [{ x: 120, y: 610 }] });
    sendEvent("touchmove", { target: addScreenshot, points: [{ x: 121, y: 580 }] });
    sendEvent("pointercancel", { target: addScreenshot });
    sendEvent("scroll", { target: settingsBody });
    sendEvent("touchend", { target: addScreenshot, endPoint: { x: 121, y: 580 } });
    sendEvent("click", { target: addScreenshot, defaultPrevented: true, isStopped: true });
  });
  assert.deepEqual(lines, [
    "touchstart at 120,610 on label.contact-secondary",
    "touchend at 121,580 on label.contact-secondary",
    "lifted after moving 1 right and 30 up; the browser took the touch; the page's code left its end; its pointer was cancelled; div.settings-body scrolled; it ended over div.settings-body",
    "the page's code stopped and took the click on label.contact-secondary",
  ]);
});

test("a touch the page's code took says when, and that it took the touch's end, and a click it took says so", async () => {
  const done = new FakeElement({ localName: "button", label: "Done" });
  elementAtPoint = done;
  const lines = await readLinesFrom(() => {
    sendEvent("touchstart", { target: done, points: [{ x: 300, y: 80 }] });
    sendEvent("touchmove", { target: done, points: [{ x: 300, y: 84 }] });
    sendEvent("touchmove", { target: done, points: [{ x: 300, y: 92 }], defaultPrevented: true });
    sendEvent("touchend", { target: done, endPoint: { x: 300, y: 92 }, defaultPrevented: true });
    sendEvent("click", { target: done, defaultPrevented: true });
  });
  assert.deepEqual(lines, [
    "touchstart at 300,80 on Done",
    "touchend at 300,92 on Done",
    "lifted after moving 12 down; the page's code took the touch once it had moved 12 down; the page's code took its end; its pointer wasn't cancelled; nothing scrolled; it ended over Done",
    "click on Done",
    "the page's code took the click on Done",
  ]);
});

test("a touch the browser cancels, a picker closed with nothing chosen, and a field that lost its file each say so", async () => {
  elementAtPoint = null;
  const lines = await readLinesFrom(() => {
    sendEvent("touchstart", { target: addScreenshot, points: [{ x: 120, y: 610 }] });
    sendEvent("touchcancel", { target: addScreenshot, endPoint: { x: 120, y: 610 } });
    sendEvent("cancel", { target: screenshotField });
    sendEvent("change", { target: makeScreenshotField([]) });
  });
  assert.deepEqual(lines, [
    "touchstart at 120,610 on label.contact-secondary",
    "cancelled without moving; neither the page's code nor the browser took the touch; the page's code left its end; its pointer wasn't cancelled; nothing scrolled; it ended over nothing",
    "the screenshot picker closed with nothing chosen",
    "the screenshot field changed with no file",
  ]);
});

test("a touch or click elsewhere on the page or on settings' Diagnostics, one a second finger joins, and a change of another field aren't logged", async () => {
  const elsewhere = new FakeElement({ isInSettings: false });
  const record = new FakeElement({ localName: "summary", isInDiagnostics: true });
  const message = new FakeElement({ id: "contactMessage", localName: "textarea" });
  const lines = await readLinesFrom(() => {
    sendEvent("touchstart", { target: elsewhere, points: [{ x: 100, y: 200 }] });
    sendEvent("touchend", { target: elsewhere, endPoint: { x: 100, y: 200 } });
    sendEvent("click", { target: elsewhere });
    sendEvent("touchstart", { target: record, points: [{ x: 100, y: 500 }] });
    sendEvent("touchend", { target: record, endPoint: { x: 100, y: 500 } });
    sendEvent("click", { target: record });
    sendEvent("touchstart", { target: addScreenshot, points: [{ x: 120, y: 610 }] });
    sendEvent("touchmove", {
      target: addScreenshot,
      points: [
        { x: 120, y: 600 },
        { x: 200, y: 300 },
      ],
    });
    sendEvent("change", { target: message });
  });
  assert.deepEqual(lines, ["touchstart at 120,610 on label.contact-secondary"]);
});

test("a touch the page's code took as it landed says it took it before it moved", async () => {
  elementAtPoint = screenshotField;
  const lines = await readLinesFrom(() => {
    sendEvent("touchstart", {
      target: addScreenshot,
      points: [{ x: 120, y: 610 }],
      defaultPrevented: true,
    });
    sendEvent("scroll", { target: /** @type {any} */ (globalThis.document) });
    sendEvent("touchend", { target: addScreenshot, endPoint: { x: 120.4, y: 610 } });
  });
  assert.deepEqual(lines, [
    "touchstart at 120,610 on label.contact-secondary",
    "touchend at 120,610 on label.contact-secondary",
    "lifted without moving; the page's code took the touch before it moved; the page's code left its end; its pointer wasn't cancelled; the page scrolled; it ended over #contactScreenshot",
  ]);
});
