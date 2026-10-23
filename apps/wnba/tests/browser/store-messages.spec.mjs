import { test, openApp } from "./harness.mjs";
import { checkUnreadableStoreMessage } from "../../../../tests/browser/store-messages.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test("Diagnostics records an unreadable store message without its payload", async ({ page }) => {
  await checkUnreadableStoreMessage(page, openApp);
});
