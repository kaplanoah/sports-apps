import { test, openApp } from "./harness.mjs";
import {
  expectLateRecordKeepsShownDay,
  expectReloadOpensOn,
  RELOAD_STATES,
} from "../../../../tests/browser/reload-states.mjs";

// The Games list after a reload from each state a phone can hold, left on a day the season's
// record lists and on one before it.

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

const SHOWN_DAYS = { recordDay: "2026-10-02", earlierDay: "2026-09-24" };

for (const { name, opensOn } of RELOAD_STATES) {
  for (const [kind, shownDay] of Object.entries(SHOWN_DAYS)) {
    const opens = opensOn[/** @type {keyof typeof SHOWN_DAYS} */ (kind)];
    test(`a reload from ${name}, left on ${shownDay}, opens the Games list on ${opens === "today" ? "today" : "that day"}`, async ({
      page,
    }) => {
      await page.addInitScript(() => localStorage.setItem("lastTab", "games"));
      await openApp(page, { isWholeSeason: true });

      await expectReloadOpensOn(page, {
        state: name,
        opensOn: opens,
        today: "2026-09-30",
        shownDay,
      });
    });
  }
}

test("a reload from the copy without its season, left on a day before the season's record lists, opens the Games list on that day when the record answers after the store stops holding", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("lastTab", "games"));
  await openApp(page, { isWholeSeason: true });

  await expectLateRecordKeepsShownDay(page, {
    today: "2026-09-30",
    shownDay: SHOWN_DAYS.earlierDay,
  });
});
