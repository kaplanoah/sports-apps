import { test, openApp, serveLockedApp } from "./harness.mjs";
import { IPHONE_AGENT } from "../../../../tests/browser/devices.mjs";
import { openSettings } from "../../../../tests/browser/settings.mjs";
import {
  checkHandoffRenewal,
  checkIconKeptOnlyOnOpen,
  checkNoteWithoutIcon,
  checkReAddHandoff,
  checkReAddNote,
  checkReAddNoteDismissal,
  checkReAddNoteEases,
  checkReAddNoteOnReload,
  checkReAddNoteOnReturn,
  checkSystemInstallIcon,
} from "../../../../tests/browser/re-add-note.mjs";

// Settings' note on bringing a Home Screen app's icon up to date with the look picked.

test.use({ contextOptions: { reducedMotion: "reduce" } });

test.describe("in an iPhone's Home Screen app", () => {
  test.use({ userAgent: IPHONE_AGENT });
  const looks = { light: "Maple", dark: "Walnut" };

  test("while the look picked, or on System the phone's, isn't the icon's, settings shows both icons and how to update it, linking to Safari on the choice picked, which the browser and Android leave out", async ({
    page,
    context,
    browser,
  }) => {
    await checkReAddNote({ page, context, browser, openApp, openSettings, looks, noteAbove: 14 });
  });

  test("the icon note's X takes it away for good in that install", async ({ page }) => {
    await checkReAddNoteDismissal({ page, openApp, openSettings, looks });
  });

  test("a reload with settings open on the icon note shows the note before the page's code arrives", async ({
    page,
  }) => {
    await checkReAddNoteOnReload({ page, openApp, openSettings, looks });
  });

  test("a reload keeps no icon for an app that has none yet, rather than the phone's setting, and settings says nothing of it until the viewer switches looks", async ({
    page,
  }) => {
    await checkIconKeptOnlyOnOpen({ page, openApp, openSettings, looks });
  });

  test("an app that doesn't know its icon shows the note from the first switch of looks, System too, until the X", async ({
    page,
  }) => {
    await checkNoteWithoutIcon({ page, openApp, openSettings, looks });
  });

  test("an app added on System has the icon the phone's setting showed as it first opened", async ({
    page,
  }) => {
    await checkSystemInstallIcon({ page, openApp, openSettings, looks });
  });

  test("the icon note grows in as a pick sets the icon off and shrinks away on its opening's curve", async ({
    page,
  }) => {
    await checkReAddNoteEases({ page, openApp, openSettings, looks });
  });

  test("on System, a change of the phone's look as the app comes back takes the icon note to its new state at once, and one later eases it", async ({
    page,
  }) => {
    await checkReAddNoteOnReturn({ page, openApp, openSettings, looks });
  });

  test("behind an access code, the link signs Safari in, so it opens the welcome on the theme picked without asking for the code", async ({
    page,
    browser,
  }) => {
    await checkReAddHandoff({ page, browser, serveLockedApp, openSettings, looks });
  });

  test("the link's handoff renews halfway through and on coming back once that's due, tries again after a failure, stops once settings closes or the icon's look is picked, and starts again as settings opens on the note", async ({
    page,
  }) => {
    await checkHandoffRenewal({ page, serveLockedApp, openSettings, looks });
  });
});
