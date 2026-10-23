---
paths:
  - "apps/**"
  - "shared/**"
---

# The current season and the store

- Which season is current, the store says in `live/current`, as the Worker decides it from the league's own data; a page never picks it by its own clock.
  A new season becomes current on the day of its first game, preseason included, as MLB's spring training and the WNBA's preseason start it,
  so through the offseason a page shows the season just played, opening on its bracket.
  Times show in the viewer's own time zone; only a league's own day is Eastern (read with the shared `readEasternDay` in `shared/page/days.js`: all of MLB's, and the WNBA's for a game without a set time).
  Pages count, read, and format days and times with `shared/page/days.js`, the one module lint lets read the machine's own calendar and clock, and its tests check each of its readings in zones on both sides of UTC;
  an app's own `readGameDay` only says which of its fields hold a game's start and its league's day.
- The store returns documents frozen, with sorted keys.
  The page writes nothing to the store; everything in it is written by the Worker.
  What a viewer chooses, like MLB's ranking, a dismissal of the Updates box,
  or the WNBA's theme, stays on their own device, since nobody signs in and people share a page's address.
  The theme also rides in the browser's address, as `?theme=`, since a Home Screen app keeps its storage apart from the browser's and opens at the address it was added from,
  and a shared link's theme is swapped for the viewer's own (`shared/page/pick-theme.js`).
  Each is a choice made with `createViewerChoice` in `shared/page/device-storage.js`,
  which keeps it as JSON under its key and tells the page when another tab changes it, so each tab redraws what it shows.
  A new choice that a viewer would want on their other devices is made the same way;
  what belongs to one device or browser, like the last tab, the Home Screen welcome's dismissal,
  or the Diagnostics, isn't a viewer choice and isn't made with it.
  An app moving to its own address carries the viewer's choices there, as many as fit, in one packed `?carried=` value,
  which the new address keeps into storage with none of its own; a Home Screen move also replaces
  the browser's appearance with the source app's current look.
  A browser accepts it only soon after it was packed, so an old copied link carries nobody's choices (`shared/page/page-move.js`).
  Its `CARRIED_CHOICES` names each choice, the most missed first, and the root's `tests/page-move.test.js` fails on one it leaves out.
