import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { classifyReadFailure, renderRetryBlock, renderRetryNote } from "../shared/page/retry.js";
import { stripTags } from "./text.js";

const readText = (markup) => stripTags(markup).replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

afterEach(() => {
  if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
});

/** @param {boolean} isOnline */
function setOnline(isOnline) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: isOnline },
  });
}

// The first line of each icon's path, which names it among Phosphor's at their Light weight.
const CELL_SIGNAL_SLASH = 'd="M86,152v48a6,6';
const PLUGS = 'd="M148.24,139.76a6,6';

test("a read that failed offline is the phone's, whatever the failure", () => {
  setOnline(false);

  assert.equal(classifyReadFailure(new TypeError("Load failed")), "offline");
  assert.equal(classifyReadFailure({ status: 502 }), "offline");
});

test("online, a read the Worker answered failed on the server, and any other didn't reach it", () => {
  setOnline(true);

  assert.equal(classifyReadFailure({ status: 502 }), "server");
  assert.equal(classifyReadFailure({ status: 200 }), "server");
  assert.equal(classifyReadFailure(new TypeError("Load failed")), "unreachable");
  assert.equal(classifyReadFailure(new DOMException("timed out", "TimeoutError")), "unreachable");
  assert.equal(classifyReadFailure(undefined), "unreachable");
});

test("offline, a whole part says so with a crossed-out signal, and that it loads once back online", () => {
  const block = renderRetryBlock("roster", "offline");

  assert.equal(
    readText(block),
    "Couldn't connect to the internet Will load roster when back online Try again",
  );
  assert.match(block.text, /^<div class="retry-block">\s*<svg class="retry-art"/);
  assert.ok(block.text.includes(CELL_SIGNAL_SLASH));
  assert.ok(!block.text.includes(PLUGS));
  assert.match(block.text, /<p class="retry-title">[^<]*<\/p>\s*<p class="retry-next">/);
  assert.match(block.text, /<button type="button" class="retry-button filled" data-retry>/);
});

test("a server out of reach, or one with a problem, shows pulled plugs and asks for a tap", () => {
  const unreachable = renderRetryBlock("box score", "unreachable");
  const server = renderRetryBlock("her numbers", "server");

  assert.equal(
    readText(unreachable),
    "Couldn't connect to the server Try again to load box score Try again",
  );
  assert.equal(
    readText(server),
    "The server had a problem Try again to load her numbers Try again",
  );
  for (const block of [unreachable, server]) {
    assert.ok(block.text.includes(PLUGS));
    assert.ok(!block.text.includes(CELL_SIGNAL_SLASH));
  }
});

test("one part that didn't load is why, after a warning icon, over an outlined Try again button", () => {
  const note = renderRetryNote("Couldn't load who started lately", "scout-note");

  assert.equal(readText(note), "Couldn't load who started lately Try again");
  assert.match(
    note.text,
    /<p class="retry-message scout-note"><svg class="retry-warning"[\s\S]*<\/svg><span>/,
  );
  assert.match(note.text, /<button type="button" class="retry-button" data-retry>/);
});
