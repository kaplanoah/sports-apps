import { test, expect, openApp } from "./harness.mjs";
import { openSettings } from "../../../../tests/browser/settings.mjs";
import { testControlStates } from "../../../../tests/browser/control-states.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

testControlStates(test, expect, {
  openApp: (page) => openApp(page, { isWholeSeason: true }),
  openSettings,
});
