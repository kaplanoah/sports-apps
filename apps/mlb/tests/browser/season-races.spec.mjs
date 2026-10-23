import { test, openApp, SEASON_2025 } from "./harness.mjs";
import { SEASON_RACES } from "../../../../tests/browser/season-races.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

for (const [name, check] of SEASON_RACES) {
  test(name, async ({ page }) => {
    await openApp(page, {
      store: { "seasons/2025": SEASON_2025, "seasons/2024": { ...SEASON_2025, year: 2024 } },
    });
    await check(page);
  });
}
