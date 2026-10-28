import { test, expect, openApp, openSettings } from "./harness.mjs";
import { testControlStates } from "../../../../tests/browser/control-states.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

testControlStates(test, expect, {
  openApp: (page) => openApp(page, { isWholeSeason: true }),
  openSettings,
});
