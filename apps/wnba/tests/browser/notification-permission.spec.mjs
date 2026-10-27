import { test, expect, openApp } from "./harness.mjs";
import { openSettings } from "../../../../tests/browser/settings.mjs";
import { testNotificationPermission } from "../../../../tests/browser/notification-permission.mjs";

testNotificationPermission(test, expect, { openApp, openSettings });
