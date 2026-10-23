// Baseball's ranking claims touches on its drag handles instead of the sheet's swipe.

import { startSettingsSheet } from "#shared/settings-sheet.js";

const isOwnGesture = (target) => target instanceof Element && !!target.closest(".grip");

export function startSettings() {
  startSettingsSheet({ isOwnGesture });
}
