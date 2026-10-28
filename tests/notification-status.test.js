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
  const active = chooseNotificationControls({ status: "on", preferences });
  assert.equal(active.areUpdatesOn, false);
  assert.equal(active.areRemindersOn, true);
  assert.equal(active.isTimingDisabled, false);
  for (const status of ["off", "failed"])
    assert.equal(chooseNotificationControls({ status, preferences }).isTimingDisabled, false);
  for (const status of ["blocked", "unsupported", "homeScreen", "loading"])
    assert.equal(chooseNotificationControls({ status, preferences }).isTimingDisabled, true);
  assert.equal(
    chooseNotificationControls({ status: "on", preferences: { updates: true, reminders: false } })
      .isTimingDisabled,
    false,
  );
});

test("a choice not yet saved shows at once, on its own switch, with a spinner only once slow", () => {
  for (const category of /** @type {const} */ (["updates", "reminders"])) {
    const preferences = { updates: category !== "updates", reminders: category !== "reminders" };
    for (const isSlow of [false, true]) {
      const controls = chooseNotificationControls({
        status: "on",
        preferences,
        wanted: { [category]: true },
        isSlow,
      });
      assert.equal(controls.areUpdatesOn, true);
      assert.equal(controls.areRemindersOn, true);
      assert.deepEqual(controls.busyCategories, [category]);
      assert.deepEqual(controls.spinnerCategories, isSlow ? [category] : []);
      assert.equal(preferences[category], false);
    }
    const saved = chooseNotificationControls({ status: "on", preferences, isSlow: true });
    assert.equal(saved.areUpdatesOn, preferences.updates);
    assert.equal(saved.areRemindersOn, preferences.reminders);
    assert.deepEqual(saved.busyCategories, []);
    assert.deepEqual(saved.spinnerCategories, []);
  }
});

test("controls stay enabled while a save runs, and only blocked notifications disable them", () => {
  const preferences = { updates: true, reminders: false, minutes: 10 };
  const wanted = { updates: false, reminders: true, minutes: 30 };
  for (const status of ["off", "on", "failed"]) {
    const controls = chooseNotificationControls({ status, preferences, wanted, isSlow: true });
    assert.equal(controls.areSwitchesDisabled, false);
    assert.equal(controls.isTimingDisabled, false);
  }
  const blocked = chooseNotificationControls({ status: "blocked", preferences, wanted });
  assert.equal(blocked.areSwitchesDisabled, true);
});

test("each switch shows its newest choice, either way, over the saved one", () => {
  const preferences = { updates: true, reminders: true, minutes: 10 };
  for (const isOn of [false, true]) {
    const controls = chooseNotificationControls({
      status: "on",
      preferences: { ...preferences, reminders: !isOn, updates: !isOn },
      wanted: { reminders: isOn, updates: isOn },
    });
    assert.equal(controls.areRemindersOn, isOn);
    assert.equal(controls.areUpdatesOn, isOn);
  }
});

test("timing shows the newest minutes chosen, else the saved ones", () => {
  const preferences = { updates: false, reminders: false, minutes: 10 };
  for (const [wantedMinutes, expected] of [
    [undefined, 10],
    [30, 30],
    [0, 0],
  ]) {
    const controls = chooseNotificationControls({
      status: "off",
      preferences,
      wanted: { reminders: true, minutes: wantedMinutes },
    });
    assert.equal(controls.timingMinutes, expected);
    assert.equal(controls.areRemindersOn, true);
    assert.equal(preferences.minutes, 10);
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
