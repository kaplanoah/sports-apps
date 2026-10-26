// Ranking claims touches on its drag handles instead of the sheet's swipe.

import { startSettingsSheet } from "#shared/settings-sheet.js";
import { startSettingsPage } from "#shared/settings-page.js";

const isOwnGesture = (target) => target instanceof Element && !!target.closest(".grip");

export function startSettings() {
  startSettingsSheet();
  startSettingsPage(/** @type {HTMLDialogElement} */ (document.getElementById("rankingDialog")), {
    button: document.getElementById("rankingBtn"),
    isOwnGesture,
  });
}
