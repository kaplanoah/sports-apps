import test from "node:test";
import assert from "node:assert/strict";
import { readNameLetters } from "../shared/worker/player-name.js";

test("a name's letters match it across accents and punctuation", () => {
  assert.equal(readNameLetters("Teoscar Hern\u00e1ndez"), readNameLetters("Teoscar Hernandez"));
  assert.equal(readNameLetters("Ke'Bryan Hayes Jr."), "kebryanhayesjr");
});
