import { openSettings } from "../../../../tests/browser/settings.mjs";
import { testGameReminderSettings } from "../../../../tests/browser/game-reminders.mjs";
import { test, expect, openApp, openLockedApp } from "./harness.mjs";

testGameReminderSettings(test, expect, {
  openApp,
  openSettings,
  openLockedApp,
  timing: "Time before tipoff",
  timingSize: 13.75,
  game: "1042600132",
  updates: "Final scores",
});
