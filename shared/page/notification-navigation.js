// Notification intent stays in the URL through the access gate and an interrupted load.
import { listOpenDialogs } from "./sheet.js";
import { openPageTab } from "./page-tabs.js";

/** @param {{ showYear: (year: number) => any, openGame: (id: string) => void }} options */
export async function openNotificationGame({ showYear, openGame }) {
  const url = new URL(location.href);
  const game = url.searchParams.get("game");
  if (game === null) return;
  await closeNotificationDialogs();
  openPageTab("games");
  const season = Number(url.searchParams.get("season"));
  if (/^\d{1,12}$/.test(game) && Number.isInteger(season) && season >= 1900 && season <= 2200) {
    try {
      await showYear(season);
      openGame(game);
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
