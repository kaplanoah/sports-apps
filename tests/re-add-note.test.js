import test from "node:test";
import assert from "node:assert/strict";
import { chooseReAddNote } from "../shared/page/re-add-note.js";

const DUE = { isIosApp: true, picked: "light", icon: "dark", isDismissed: false };

test("the note shows in an iPhone's Home Screen app while the look picked isn't its icon's, with both", () => {
  assert.deepEqual(chooseReAddNote(DUE), { icon: "dark", picked: "light" });
  assert.deepEqual(chooseReAddNote({ ...DUE, picked: "dark", icon: "light" }), {
    icon: "light",
    picked: "dark",
  });
});

test("the note leaves once the look picked is the icon's again", () => {
  assert.equal(chooseReAddNote({ ...DUE, picked: "dark" }), null);
  assert.equal(chooseReAddNote({ ...DUE, icon: "light" }), null);
});

test("the note says nothing on System, which no icon follows", () => {
  assert.equal(chooseReAddNote({ ...DUE, picked: "auto" }), null);
});

test("the note stays away once dismissed", () => {
  assert.equal(chooseReAddNote({ ...DUE, isDismissed: true }), null);
});

test("the note shows only in an iPhone's or iPad's Home Screen app, and only once it knows the icon", () => {
  assert.equal(chooseReAddNote({ ...DUE, isIosApp: false }), null);
  assert.equal(chooseReAddNote({ ...DUE, icon: null }), null);
  assert.equal(chooseReAddNote({ ...DUE, icon: "sepia" }), null);
});
