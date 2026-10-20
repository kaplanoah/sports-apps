import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseReAddNote,
  isLookSwitched,
  isReAddNoteDismissed,
  keepLookSwitched,
  keepReAddNoteDismissed,
} from "../shared/page/re-add-note.js";
import { dropSavedStorage, useDeniedStorage, useSavedStorage } from "./saved-storage.js";

const DUE = {
  isIosApp: true,
  choice: "light",
  icon: "dark",
  phoneLook: /** @type {"light" | "dark"} */ ("light"),
  isSwitched: true,
  isDismissed: false,
};

test("the note shows in an iPhone's Home Screen app while the look picked isn't its icon's, with both", () => {
  assert.deepEqual(chooseReAddNote(DUE), { icon: "dark", picked: "light", choice: "light" });
  assert.deepEqual(chooseReAddNote({ ...DUE, choice: "dark", icon: "light" }), {
    icon: "light",
    picked: "dark",
    choice: "dark",
  });
});

test("the note leaves once the look picked is the icon's again", () => {
  assert.equal(chooseReAddNote({ ...DUE, choice: "dark" }), null);
  assert.equal(chooseReAddNote({ ...DUE, icon: "light" }), null);
});

test("on System, an app that knows its icon shows the note while the phone's look isn't the icon's, with a link back on System", () => {
  assert.deepEqual(chooseReAddNote({ ...DUE, choice: "auto", phoneLook: "light" }), {
    icon: "dark",
    picked: "light",
    choice: "auto",
  });
  assert.equal(chooseReAddNote({ ...DUE, choice: "auto", phoneLook: "dark" }), null);
  assert.equal(
    chooseReAddNote({ ...DUE, choice: "auto", icon: "light", phoneLook: "light" }),
    null,
  );
});

test("the note stays away once dismissed, whether or not the app knows its icon", () => {
  assert.equal(chooseReAddNote({ ...DUE, isDismissed: true }), null);
  assert.equal(chooseReAddNote({ ...DUE, icon: null, isDismissed: true }), null);
});

test("the note shows only in an iPhone's or iPad's Home Screen app", () => {
  assert.equal(chooseReAddNote({ ...DUE, isIosApp: false }), null);
  assert.equal(chooseReAddNote({ ...DUE, icon: null, isIosApp: false }), null);
});

test("an app that doesn't know its icon says nothing until the viewer switches looks", () => {
  assert.equal(chooseReAddNote({ ...DUE, icon: null, isSwitched: false }), null);
  assert.equal(chooseReAddNote({ ...DUE, icon: "sepia", isSwitched: false }), null);
});

test("once the viewer switches looks, an app that doesn't know its icon shows the note for each look, with the other as its icon", () => {
  const unknown = { ...DUE, icon: null };
  assert.deepEqual(chooseReAddNote(unknown), { icon: "dark", picked: "light", choice: "light" });
  assert.deepEqual(chooseReAddNote({ ...unknown, choice: "dark" }), {
    icon: "light",
    picked: "dark",
    choice: "dark",
  });
});

test("an app that doesn't know its icon shows the note on System too, with the phone's look and a link back on System", () => {
  const unknown = { ...DUE, icon: null, choice: "auto" };
  assert.deepEqual(chooseReAddNote({ ...unknown, phoneLook: "dark" }), {
    icon: "light",
    picked: "dark",
    choice: "auto",
  });
  assert.deepEqual(chooseReAddNote({ ...unknown, phoneLook: "light" }), {
    icon: "dark",
    picked: "light",
    choice: "auto",
  });
});

test("an install reads whether the viewer switched looks from its storage, so the note stays through a reload", (t) => {
  t.after(dropSavedStorage);
  useSavedStorage(new Map());
  assert.equal(isLookSwitched(), false);
  useSavedStorage(new Map([["lookSwitched", "switched"]]));
  assert.equal(isLookSwitched(), true);
});

test("a switch of looks is saved for the install", (t) => {
  t.after(dropSavedStorage);
  const saved = new Map();
  useSavedStorage(saved);
  keepLookSwitched();
  assert.equal(saved.get("lookSwitched"), "switched");
});

test("a dismissal and a switch last until the page reloads on a device whose storage refuses access", (t) => {
  useDeniedStorage();
  t.after(dropSavedStorage);
  assert.equal(isReAddNoteDismissed(), false);
  keepReAddNoteDismissed();
  assert.equal(isReAddNoteDismissed(), true);
  keepLookSwitched();
  assert.equal(isLookSwitched(), true);
});
