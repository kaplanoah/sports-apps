import { test, expect, openApp } from "./harness.mjs";
import { turnOnDiagnostics } from "../../../../tests/browser/diagnostics-switch.mjs";
import { openSettings } from "../../../../tests/browser/settings.mjs";
import { setHidden } from "../../../../tests/browser/visibility.mjs";
import { RECORD_MS, findRecords, reloadAndRecord, reloadToRecord } from "./diagnostics-records.mjs";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

test("with Diagnostics on, each change of the phone's look is logged, with what the page reads then and a task later, and among the steps of the open under way", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await reloadToRecord(page);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.clock.runFor(100);
  await page.emulateMedia({ colorScheme: "light" });
  await page.clock.runFor(RECORD_MS + 1000);
  await openSettings(page);

  const log = findRecords(page).locator(".diagnostics-record", { hasText: "Phone look" });
  await log.locator("summary").click();
  const changes = log.locator("li", { hasText: "the phone reports" });
  await expect(changes.first()).toContainText(
    /the phone reports light; reads light, then light \d+ms later; page shown/,
  );
  await expect(changes.nth(1)).toContainText(
    /the phone reports dark; reads dark, then dark \d+ms later; page shown/,
  );
  await expect(
    findRecords(page).locator(".diagnostics-record").first().locator("li", {
      hasText: "the phone reports dark",
    }),
  ).toHaveCount(1);
});

test("with Diagnostics on, the page leaving the screen is kept on the device as it leaves, in the log and in the record it closes, so a phone that drops the page while it's away keeps the line", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await reloadToRecord(page);

  const kept = await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    return {
      log: localStorage.getItem("diagnosticsPhoneLook") ?? "",
      records: localStorage.getItem("diagnosticsRecords") ?? "",
    };
  });

  const line = "the page left the screen; reads light, shows light";
  expect(kept.log).toContain(line);
  expect(kept.records).toContain(line);
});

test("with Diagnostics on, the page coming back is among the steps of the return's own record", async ({
  page,
}) => {
  await openApp(page);
  await turnOnDiagnostics(page);
  await reloadAndRecord(page);

  await setHidden(page, true);
  await setHidden(page, false);
  await page.clock.runFor(100);
  await openSettings(page);

  const comeBack = findRecords(page)
    .locator(".diagnostics-record", { hasText: "Back after" })
    .first();
  await expect(comeBack.locator("li", { hasText: "the page came back" })).toHaveCount(1);
});
