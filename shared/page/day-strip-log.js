import { createStepLog } from "./step-log.js";

// What a season's list of days does: each touch and click on its strip, its Today, and its list,
// and where each tap on a day or on Today takes the list and when it arrives, with what each fill
// draws and where it leaves the list. It also logs each new day at the list's top and whether the
// strip's dates slide to it, any day that changes height as it's drawn whole or as a stand-in, and
// a strip that doesn't scroll where it's told.
export const dayStripLog = createStepLog({
  key: "diagnosticsDayStrip",
  title: "Games list",
  isWatched: (target) => !!target.closest(".day-view"),
});
