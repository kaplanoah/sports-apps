import test from "node:test";
import assert from "node:assert/strict";
import { chooseFailedSyncStatus } from "../shared/page/notification-status.js";

test("a visit's save that fails for a moment leaves the switch on while the browser keeps the subscription", () => {
  assert.equal(chooseFailedSyncStatus(true), null);
});

test("a visit's save that fails once the browser no longer holds the subscription shows the switch off", () => {
  assert.equal(chooseFailedSyncStatus(false), "off");
});
