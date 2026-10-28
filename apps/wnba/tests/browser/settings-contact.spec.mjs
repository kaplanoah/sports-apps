import { test, expect, openApp } from "./harness.mjs";
import { registerSettingsContactInteractions } from "../../../../tests/browser/settings-contact-interactions.mjs";

registerSettingsContactInteractions({ test, expect, openApp, app: "wnba" });
