import { test, expect, openApp } from "./harness.mjs";
import { SETTINGS_PAGES } from "./views.mjs";
import { testContactPresses } from "../../../../tests/browser/contact-presses.mjs";

testContactPresses(test, expect, { openApp, settingsPages: SETTINGS_PAGES });
