import { test } from "node:test";
import assert from "node:assert/strict";
import { findKeptTop } from "../shared/page/kept-place.js";

test("a list scrolled down moves by as much as what's above it grows or shrinks", () => {
  assert.equal(findKeptTop(400, 88), 488);
  assert.equal(findKeptTop(400, -18), 382);
});

test("a list at its top stays there, so what opens above it shows", () => {
  assert.equal(findKeptTop(0, 88), 0);
  assert.equal(findKeptTop(0.5, 88), 0.5);
});

test("a list scrolled less than what's above it shrinks goes to its top", () => {
  assert.equal(findKeptTop(40, -106), 0);
});
