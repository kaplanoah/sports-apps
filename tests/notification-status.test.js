import test from "node:test";
import assert from "node:assert/strict";
import { chooseFailedSyncStatus, TOO_MANY_DEVICES } from "../shared/page/notification-status.js";

const describeFailure = (/** @type {string} */ code) =>
  Object.assign(new Error("The Worker answered"), { code });

test("a visit's save the Worker turns away shows the switch off, saying why", () => {
  for (const isSubscribed of [true, false])
    assert.deepEqual(chooseFailedSyncStatus(describeFailure("too_many_devices"), isSubscribed), {
      status: "off",
      note: TOO_MANY_DEVICES,
    });
});

test("a visit's save that fails for a moment leaves the switch on while the browser keeps the subscription", () => {
  for (const error of [describeFailure("unavailable"), new TypeError("Failed to fetch")])
    assert.equal(chooseFailedSyncStatus(error, true), null);
});

test("a visit's save that fails once the browser no longer holds the subscription shows the switch off", () => {
  assert.deepEqual(chooseFailedSyncStatus(describeFailure("unavailable"), false), {
    status: "off",
    note: "",
  });
});
