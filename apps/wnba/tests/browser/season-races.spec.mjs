import { test, openApp } from "./harness.mjs";
import { ONE_PAST_SEASON } from "./past-season.mjs";
import { SEASON_RACES } from "../../../../tests/browser/season-races.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

for (const [name, check] of SEASON_RACES) {
  test(name, async ({ page }) => {
    await openApp(page, {
      pastSeasons: {
        ...ONE_PAST_SEASON.pastSeasons,
        2024: (season) => ({ ...ONE_PAST_SEASON.pastSeasons[2025](season), season: 2024 }),
      },
    });
    await check(page);
  });
}
