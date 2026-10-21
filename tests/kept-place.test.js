import { test } from "node:test";
import assert from "node:assert/strict";
import { findKeptTop, findShortfall } from "../shared/page/kept-place.js";

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

test("what a scroll falls short by, landing on whole pixels, carries to the next change", () => {
  assert.equal(findShortfall(488.25, 488), 0.25);
  assert.equal(findShortfall(487.75, 488), -0.25);
});

test("a scroll held back a pixel or more, at its list's end, carries nothing", () => {
  assert.equal(findShortfall(900, 840), 0);
});
