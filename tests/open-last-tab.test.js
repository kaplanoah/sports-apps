import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const script = readFileSync(new URL("../shared/page/open-last-tab.js", import.meta.url), "utf8");

function readParts(value, refusesStorage = false) {
  const context = createContext({
    localStorage: {
      getItem: () => {
        if (refusesStorage) throw new Error("Storage refused");
        return value;
      },
    },
    location: { href: "https://app.example/" },
    readNotificationIntent: () => ({ isRequested: false }),
    document: {},
    MutationObserver: class {
      observe() {}
    },
  });
  runInContext(script, context);
  return JSON.parse(JSON.stringify(runInContext("readSavedParts()", context)));
}

test("saved parts retain a stored view and reject non-object or unreadable storage", () => {
  const saved = { gameSearch: { hidden: false, savedAt: 123, markup: "Saved results" } };
  assert.deepEqual(readParts(JSON.stringify(saved)), saved);
  for (const value of [null, "{", "null", "false", "42", '"saved"'])
    assert.deepEqual(readParts(value), {});
  assert.deepEqual(readParts(JSON.stringify(saved), true), {});
});
