/* global readNotificationIntent -- from notification-intent.js */
// Notification intent stays in the URL through the access gate and an interrupted load.
import { listOpenDialogs } from "./sheet.js";
import { openPageTab } from "./page-tabs.js";

/** @param {{ showYear: (year: number) => any, openGame: (id: string) => void }} options */
export async function openNotificationGame({ showYear, openGame }) {
  const url = new URL(location.href);
  const { isRequested, target } = readNotificationIntent(url.href);
  if (!isRequested) return;
  await closeNotificationDialogs();
  openPageTab("games");
  if (target) {
    try {
      await showYear(target.season);
      openGame(target.game);
    } catch {
      /* Games remains available when the requested season cannot be read. */
    }
  }
  url.searchParams.delete("game");
  url.searchParams.delete("season");
  history.replaceState(history.state, "", url);
}

function closeNotificationDialogs() {
  return Promise.all(
    listOpenDialogs().map(
      ({ dialog }) =>
        new Promise((resolve) => {
          dialog.addEventListener("close", () => resolve(undefined), { once: true });
          dialog.close();
        }),
    ),
  );
}
