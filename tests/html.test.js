import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capitalize,
  convertToText,
  html,
  isWebAddress,
  joinNames,
  joinWithSeparator,
} from "../shared/page/html.js";

test("each fact in a line of facts keeps the dot after it, so a line breaks only after a dot", () => {
  assert.equal(
    joinWithSeparator(["Lead changes: 15", "Ties: 14", "Timeouts left: 1"]).text,
    '<span class="fact">Lead changes: 15<span class="sep">&bull;</span></span>' +
      '<span class="fact">Ties: 14<span class="sep">&bull;</span></span>' +
      '<span class="fact">Timeouts left: 1</span>',
  );
});

test("a line of facts escapes each fact", () => {
  assert.equal(joinWithSeparator(["<b>"]).text, '<span class="fact">&lt;b&gt;</span>');
});

test("markup as text reads each entity as its character, and the separator with a space each side", () => {
  assert.equal(
    convertToText(joinWithSeparator(["Tied 2-2", html`<b>Tomorrow</b>`])),
    "Tied 2-2 \u2022 Tomorrow",
  );
  assert.equal(convertToText(html`A&bull;B &amp; C&nbsp;D`), "A\u2022B & C\u00a0D");
});

test("only a web address is a link", () => {
  assert.ok(isWebAddress("https://www.espn.com/wnba/story"));
  assert.ok(isWebAddress("HTTP://example.com"));
  for (const url of ["javascript:alert(1)", " https://example.com", "data:text/html,x", "", null])
    assert.ok(!isWebAddress(/** @type {any} */ (url)), String(url));
});

test("names join as a sentence does, and text starts with a capital", () => {
  assert.equal(joinNames(["Mets"], "or"), "Mets");
  assert.equal(joinNames(["Mets", "Yankees"], "or"), "Mets or Yankees");
  assert.equal(joinNames(["'a'", "'b'", "'c'"], "and"), "'a', 'b', and 'c'");
  assert.equal(capitalize("opening Day"), "Opening Day");
});
