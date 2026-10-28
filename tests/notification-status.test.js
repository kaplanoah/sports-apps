import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseNotificationControls,
  chooseDeniedStatus,
  CHANGE_FAILED,
  chooseFailedSyncStatus,
  chooseNotifyNote,
  splitAtLastWord,
  TOO_MANY_DEVICES,
} from "../shared/page/notification-status.js";

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

const IPHONE_SAFARI = { isIos: true, isOnHomeScreen: false, canOpenWelcome: true };
const IPHONE_APP = { isIos: true, isOnHomeScreen: true, canOpenWelcome: false };
const IPAD_WITH_TRACKPAD = { isIos: true, isOnHomeScreen: false, canOpenWelcome: false };
const COMPUTER = { isIos: false, isOnHomeScreen: false, canOpenWelcome: false };

/**
 * @param {string} status
 * @param {import("../shared/page/notification-status.js").NoteDevice} device
 * @param {string} [message]
 */
const readNote = (status, device, message = "") => chooseNotifyNote({ status, message, device });

test("Safari outside the Home Screen says why notifications need it, ending with a ? wherever the welcome can open", () => {
  const text =
    "Apple only supports notifications from sites saved to your home screen. To configure notifications, add this site to your home screen.";
  assert.deepEqual(readNote("homeScreen", IPHONE_SAFARI), { text, hasHelp: true });
  assert.deepEqual(readNote("homeScreen", IPAD_WITH_TRACKPAD), { text, hasHelp: false });
});

test("a browser that can't show notifications says what to try, and a Home Screen app only that it can't", () => {
  assert.deepEqual(readNote("unsupported", COMPUTER), {
    text: "This browser can't show notifications. Try another browser or a window that isn't private.",
    hasHelp: false,
  });
  assert.deepEqual(readNote("unsupported", IPHONE_APP), {
    text: "This browser can't show notifications",
    hasHelp: false,
  });
});

test("blocked notifications point to Settings on iOS and to the site's settings elsewhere", () => {
  assert.match(readNote("blocked", IPHONE_APP).text, /Settings > Notifications/);
  assert.match(readNote("blocked", COMPUTER).text, /browser's site settings/);
});

test("a switch that couldn't turn on says to try again", () => {
  assert.deepEqual(readNote("failed", COMPUTER), { text: CHANGE_FAILED, hasHelp: false });
});

test("a message the switch was given wins, and working notifications need no guidance", () => {
  assert.deepEqual(readNote("off", COMPUTER, TOO_MANY_DEVICES), {
    text: TOO_MANY_DEVICES,
    hasHelp: false,
  });
  for (const status of ["off", "on"]) assert.equal(readNote(status, IPHONE_APP).text, "");
});

test("the note splits before its last word, which the ? keeps to", () => {
  assert.deepEqual(splitAtLastWord("add this site to your home screen."), [
    "add this site to your home ",
    "screen.",
  ]);
  assert.deepEqual(splitAtLastWord("screen."), ["", "screen."]);
});

test("category controls stay independent and timing can enable reminders", () => {
  const preferences = { updates: false, reminders: true };
  const active = chooseNotificationControls({ status: "on", isBusy: false, preferences });
  assert.equal(active.areUpdatesOn, false);
  assert.equal(active.areRemindersOn, true);
  assert.equal(active.isTimingDisabled, false);
  for (const status of ["off", "failed"])
    assert.equal(
      chooseNotificationControls({ status, isBusy: false, preferences }).isTimingDisabled,
      false,
    );
  for (const status of ["blocked", "unsupported", "homeScreen", "loading"])
    assert.equal(
      chooseNotificationControls({ status, isBusy: false, preferences }).isTimingDisabled,
      true,
    );
  assert.equal(
    chooseNotificationControls({ status: "on", isBusy: true, preferences }).isTimingDisabled,
    false,
  );
  assert.equal(
    chooseNotificationControls({
      status: "on",
      isBusy: false,
      preferences: { updates: true, reminders: false },
    }).isTimingDisabled,
    false,
  );
});

test("pending category intent changes only its switch and exposes only a delayed indicator", () => {
  for (const category of ["updates", "reminders"]) {
    const preferences = { updates: category !== "updates", reminders: category !== "reminders" };
    for (const elapsedMs of [0, 699, 700]) {
      const controls = chooseNotificationControls({
        status: "on",
        isBusy: true,
        preferences,
        pending: { category, isEnabled: true, elapsedMs },
      });
      assert.equal(controls.areUpdatesOn, true);
      assert.equal(controls.areRemindersOn, true);
      assert.equal(controls.areSwitchesDisabled, true);
      assert.equal(controls.isTimingDisabled, true);
      assert.equal(controls.pendingCategory, category);
      assert.equal(controls.spinnerCategory, elapsedMs >= 700 ? category : "");
      assert.equal(preferences[category], false);
    }
    const restored = chooseNotificationControls({ status: "on", isBusy: false, preferences });
    assert.equal(restored.areUpdatesOn, preferences.updates);
    assert.equal(restored.areRemindersOn, preferences.reminders);
    assert.equal(restored.spinnerCategory, "");
  }
});

test("a save keeps every control's look while blocked notifications fade them", () => {
  const preferences = { updates: true, reminders: false, minutes: 10 };
  for (const status of ["off", "on", "failed"]) {
    assert.equal(chooseNotificationControls({ status, isBusy: true, preferences }).isSaving, true);
    assert.equal(
      chooseNotificationControls({ status, isBusy: false, preferences }).isSaving,
      false,
    );
  }
  for (const isBusy of [false, true]) {
    const blocked = chooseNotificationControls({ status: "blocked", isBusy, preferences });
    assert.equal(blocked.isSaving, false);
    assert.equal(blocked.areSwitchesDisabled, true);
  }
});

test("the reminder switch follows both pending intents and the saved choice", () => {
  const preferences = { updates: true, reminders: true, minutes: 10 };
  for (const isEnabled of [false, true]) {
    const controls = chooseNotificationControls({
      status: "on",
      isBusy: true,
      preferences: { ...preferences, reminders: !isEnabled },
      pending: { category: "reminders", isEnabled, elapsedMs: 0 },
    });
    assert.equal(controls.areRemindersOn, isEnabled);
    assert.equal(controls.areUpdatesOn, true);
  }
  for (const reminders of [false, true]) {
    const controls = chooseNotificationControls({
      status: "on",
      isBusy: false,
      preferences: { ...preferences, reminders },
    });
    assert.equal(controls.areRemindersOn, reminders);
  }
});

test("timing minutes use the latest request then pending intent then saved choice", () => {
  const preferences = { updates: false, reminders: false, minutes: 10 };
  for (const [requested, pendingMinutes, expected] of [
    [null, undefined, 10],
    [null, 30, 30],
    [0, 30, 0],
    [60, 0, 60],
    [null, 0, 0],
  ]) {
    const controls = chooseNotificationControls({
      status: "off",
      isBusy: true,
      preferences,
      timingMinutes: requested,
      pending: { category: "reminders", isEnabled: true, elapsedMs: 0, minutes: pendingMinutes },
    });
    assert.equal(controls.timingMinutes, expected);
    assert.equal(controls.areRemindersOn, true);
    assert.equal(preferences.minutes, 10);
    assert.equal(preferences.reminders, false);
  }
});

test("permission denial keeps the other category's status and returns plain guidance", () => {
  for (const device of [IPHONE_APP, COMPUTER])
    for (const previousStatus of ["on", "off", "failed"])
      for (const permission of ["default", "denied"])
        assert.deepEqual(chooseDeniedStatus({ previousStatus, permission, device }), {
          status: previousStatus === "on" ? "on" : permission === "denied" ? "blocked" : "off",
          note: permission === "denied" ? readNote("blocked", device).text : "",
        });
});
