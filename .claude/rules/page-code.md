---
paths:
  - "apps/*/page/**"
  - "shared/page/**"
  - "apps/*/tests/browser/sheet-reload.spec.mjs"
---

# How the pages are built

- Build page markup with the `html` template from `shared/page/html.js` and write it with `setHtml`.
  Both escape stored and fetched text, and lint rejects any other `innerHTML` write.
  `setHtml` changes only the nodes that differ from what the element shows, so a redraw keeps the rest as it is.
- A reload draws each open sheet as it was.
  A sheet that reads from the Worker keeps what it read in its `keeper` (`wireSheet` in `shared/page/sheet.js`),
  beside what it shows, and draws again from that while it reads again,
  never its placeholders, as the game sheet does with its box score and a team's sheet with its roster (`sectionsKeeper` in `shared/page/team-sheet.js`).
  Each app's `tests/browser/sheet-reload.spec.mjs` reloads each sheet with its reads held and checks it shows the same; a new sheet joins its list, or the test fails.
