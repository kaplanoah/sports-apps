import { test, expect, openApp } from "./harness.mjs";
import { testContactPresses } from "../../../../tests/browser/contact-presses.mjs";

testContactPresses(test, expect, { openApp, settingsPages: ["Contact"] });
