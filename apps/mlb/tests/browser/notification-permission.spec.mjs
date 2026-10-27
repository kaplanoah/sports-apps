import { test, expect, openApp, openSettings } from "./harness.mjs";
import { testNotificationPermission } from "../../../../tests/browser/notification-permission.mjs";

testNotificationPermission(test, expect, { openApp, openSettings });
