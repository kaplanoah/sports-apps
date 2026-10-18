import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createViewerChoice, listViewerChoices } from "../shared/page/device-storage.js";
import {
  dropSavedStorage,
  refuseAccess,
  useFullStorage,
  useSavedStorage,
  useStorage,
} from "./saved-storage.js";

const otherTabs = new EventTarget();
Object.assign(globalThis, { addEventListener: otherTabs.addEventListener.bind(otherTabs) });

/** @param {string | null} key */
const changeInOtherTab = (key) =>
  otherTabs.dispatchEvent(Object.assign(new Event("storage"), { key }));

/** @param {unknown} stored */
const readAsIs = (stored) => stored;

afterEach(dropSavedStorage);

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

test("a device whose storage is full reads the choice it couldn't keep, not the older one stored", () => {
  const saved = new Map([["full", "1"]]);
  useFullStorage(saved);
  const choice = createViewerChoice("full", readAsIs);

  choice.keep(2);

  assert.equal(choice.read(), 2);
});

test("a choice storage couldn't keep gives way to another tab's newer one", () => {
  const saved = new Map([["fullThenSaved", "1"]]);
  useFullStorage(saved);
  const choice = createViewerChoice("fullThenSaved", readAsIs);
  /** @type {unknown[]} */
  const reads = [];
  choice.watch(() => reads.push(choice.read()));
  choice.keep(2);

  saved.set("fullThenSaved", "3");
  changeInOtherTab("fullThenSaved");

  assert.deepEqual(reads, [3]);
});

test("a choice storage couldn't keep gives way to another tab clearing storage", () => {
  const saved = new Map([["fullThenCleared", "1"]]);
  useFullStorage(saved);
  const choice = createViewerChoice("fullThenCleared", readAsIs);
  /** @type {unknown[]} */
  const reads = [];
  choice.watch(() => reads.push(choice.read()));
  choice.keep(2);

  saved.clear();
  changeInOtherTab(null);

  assert.deepEqual(reads, [null]);
});
