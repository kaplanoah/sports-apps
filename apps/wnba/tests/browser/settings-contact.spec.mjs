import { test, expect, openApp } from "./harness.mjs";
import { SETTINGS_PAGES } from "./views.mjs";
import { testSettingsContactInteractions } from "../../../../tests/browser/settings-contact-interactions.mjs";

testSettingsContactInteractions(test, expect, { openApp, settingsPages: SETTINGS_PAGES });
