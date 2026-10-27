import { test, expect, openApp } from "./harness.mjs";
import { openSettings } from "../../../../tests/browser/settings.mjs";
import { testNotificationAlignment } from "../../../../tests/browser/notification-layout.mjs";

testNotificationAlignment(test, expect, {
  openApp,
  openSettings,
  field: {
    width: 145,
    height: 40,
    top: 7,
    bottom: 7,
    left: 8,
    right: 20,
    caretRight: 3,
    caretWidth: 16,
    minimumGap: 0,
  },
});
