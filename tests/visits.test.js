import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createVisitReporter, startVisits } from "../shared/page/visits.js";

const MINUTE_MS = 60 * 1000;

test("only the first visible opening and a return after thirty minutes count as visits", async () => {
  let visible = false;
  let visits = 0;
  const reportVisit = createVisitReporter({
    send: async () => {
      visits += 1;
    },
    isVisible: () => visible,
  });
  reportVisit();
  visible = true;
  reportVisit(1000);
  reportVisit(0);
  reportVisit(29 * MINUTE_MS);
  await Promise.resolve();
  assert.equal(visits, 1);
  reportVisit(30 * MINUTE_MS);
  reportVisit(0);
  await Promise.resolve();
  assert.equal(visits, 2);
  visible = false;
  reportVisit(60 * MINUTE_MS);
  await Promise.resolve();
  assert.equal(visits, 2);
});

test("a failed visit request does not interrupt the app or retry in the background", async () => {
  const send = mock.fn(async () => {
    throw new Error("offline");
  });
  const reportVisit = createVisitReporter({ send, isVisible: () => true });
  reportVisit();
  await Promise.resolve();
  await Promise.resolve();
  reportVisit(0);
  assert.equal(send.mock.callCount(), 1);
  reportVisit(30 * MINUTE_MS);
  await Promise.resolve();
  assert.equal(send.mock.callCount(), 2);
});

for (const navigator of [
  { webdriver: true },
  { webdriver: false, doNotTrack: "1" },
  { globalPrivacyControl: true },
]) {
  test(`automated or opted-out browsers do not start visit reporting: ${JSON.stringify(navigator)}`, (t) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigator });
    t.after(() => Object.defineProperty(globalThis, "navigator", original));
    // There is no document in Node: touching the page would throw before any request is made.
    assert.doesNotThrow(startVisits);
  });
}
