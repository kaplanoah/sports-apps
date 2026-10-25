import { openSettings } from "../../../../tests/browser/settings.mjs";
import { testGameReminderSettings } from "../../../../tests/browser/game-reminders.mjs";
import { test, expect, openApp, openLockedApp } from "./harness.mjs";

testGameReminderSettings(test, expect, {
  openApp,
  openSettings,
  openLockedApp,
  game: "1042600132",
  updates: "Final scores",
});
