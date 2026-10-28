import { test, expect, openApp, openSettings } from "./harness.mjs";
import { testNotificationAlignment } from "../../../../tests/browser/notification-layout.mjs";

testNotificationAlignment(test, expect, {
  openApp,
  openSettings,
  field: {
    width: 173,
    height: 40,
    top: 6.5,
    bottom: 7.5,
    left: 8,
    right: 25.5,
    caretRight: 6.5,
    caretWidth: 16,
    minimumGap: 4,
  },
});
