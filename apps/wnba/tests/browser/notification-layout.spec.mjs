import { test, expect, openApp } from "./harness.mjs";
import { openSettings } from "../../../../tests/browser/settings.mjs";
import { testNotificationAlignment } from "../../../../tests/browser/notification-layout.mjs";

testNotificationAlignment(test, expect, { openApp, openSettings, isMlb: false });
