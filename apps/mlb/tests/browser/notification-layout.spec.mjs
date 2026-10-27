import { test, expect, openApp, openSettings } from "./harness.mjs";
import { testNotificationAlignment } from "../../../../tests/browser/notification-layout.mjs";

testNotificationAlignment(test, expect, { openApp, openSettings, isMlb: true });
