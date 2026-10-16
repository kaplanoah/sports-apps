import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createViewerChoice, listViewerChoices } from "../shared/page/device-storage.js";

const otherTabs = new EventTarget();
Object.assign(globalThis, { addEventListener: otherTabs.addEventListener.bind(otherTabs) });

/** @param {Partial<Storage>} storage */
const useStorage = (storage) =>
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

/** @param {Map<string, string>} saved */
const useSavedStorage = (saved) =>
  useStorage({
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  });

const refuseAccess = () => {
  throw new Error("Access denied");
};

/** @param {string | null} key */
const changeInOtherTab = (key) =>
  otherTabs.dispatchEvent(Object.assign(new Event("storage"), { key }));

/** @param {unknown} stored */
const readAsIs = (stored) => stored;

afterEach(() => {
  delete (/** @type {any} */ (globalThis).localStorage);
});

test("a choice is kept as JSON under its key", () => {
  const saved = new Map();
  useSavedStorage(saved);

  createViewerChoice("rankings", readAsIs).keep({ 2026: ["NYY", "LAD"] });

  assert.equal(saved.get("rankings"), '{"2026":["NYY","LAD"]}');
});

test("a choice kept on an earlier load reads back", () => {
  useSavedStorage(new Map([["updatesSeenAt", "1759300000000"]]));

  assert.equal(createViewerChoice("updatesSeenAt", readAsIs).read(), 1759300000000);
});

test("a choice kept as plain text reads as that text", () => {
  useSavedStorage(new Map([["appearance", "dark"]]));

  assert.equal(createViewerChoice("appearance", readAsIs).read(), "dark");
});

test("a choice with nothing kept hands its reader null, for its default", () => {
  useSavedStorage(new Map());

  assert.equal(createViewerChoice("missing", (stored) => stored ?? "auto").read(), "auto");
});

test("each read goes to storage, so a change from another tab shows", () => {
  const saved = new Map([["newsChoices", '{"paywalled":true}']]);
  useSavedStorage(saved);
  const choice = createViewerChoice("newsChoices", readAsIs);
  assert.deepEqual(choice.read(), { paywalled: true });

  saved.set("newsChoices", '{"paywalled":false}');

  assert.deepEqual(choice.read(), { paywalled: false });
});

test("a choice tells its watchers when another tab changes it, or clears storage", () => {
  useSavedStorage(new Map());
  let changes = 0;
  const stopWatching = createViewerChoice("watched", readAsIs).watch(() => changes++);

  changeInOtherTab("watched");
  changeInOtherTab("unwatched");
  changeInOtherTab(null);
  stopWatching();
  changeInOtherTab("watched");

  assert.equal(changes, 2);
});

test("a choice kept on this page leaves redrawing to the page that kept it", () => {
  useSavedStorage(new Map());
  const choice = createViewerChoice("keptHere", readAsIs);
  let changes = 0;
  choice.watch(() => changes++);

  choice.keep(true);

  assert.equal(changes, 0);
});

test("every choice the page makes is listed by its key", () => {
  createViewerChoice("listed", readAsIs);

  assert.ok(listViewerChoices().includes("listed"));
});

test("a device whose storage refuses access keeps a choice until the page reloads", () => {
  useStorage({ getItem: refuseAccess, setItem: refuseAccess });
  const choice = createViewerChoice("refused", readAsIs);

  assert.equal(choice.read(), null);
  choice.keep({ "https://example.com/story": 1 });

  assert.deepEqual(choice.read(), { "https://example.com/story": 1 });
});

test("a device whose storage is full keeps a choice it wouldn't take until the page reloads", () => {
  useStorage({
    getItem: () => '"old"',
    setItem: () => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    },
  });
  const choice = createViewerChoice("full", readAsIs);

  choice.keep("new");

  assert.equal(choice.read(), "new");
});

test("a choice another tab makes takes the place of one this tab's full storage wouldn't take", () => {
  const saved = new Map([["fullHere", '"old"']]);
  useStorage({
    getItem: (key) => saved.get(key) ?? null,
    setItem: () => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    },
  });
  const choice = createViewerChoice("fullHere", readAsIs);
  /** @type {unknown[]} */
  const shown = [];
  choice.watch(() => shown.push(choice.read()));
  choice.keep("mine");

  saved.set("fullHere", '"theirs"');
  changeInOtherTab("fullHere");
  choice.keep("mine again");
  changeInOtherTab(null);

  assert.deepEqual(shown, ["theirs", "theirs"]);
});
