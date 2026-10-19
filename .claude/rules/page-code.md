---
paths:
  - "apps/*/page/**"
  - "shared/page/**"
  - "apps/*/tests/browser/sheet-reload.spec.mjs"
  - "apps/*/tests/search.test.js"
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
- Each app's `page/js/app.js` is its entry module; shared page data lives in `page/js/session.js`.
- Release notes: each app's `page/js/release-notes.js` lists what's new in the app.
  Its Updates box shows them under New in the app, the newest three and how many more,
  until it's dismissed or two weeks after the device first showed it,
  so a viewer back from time away still sees what they missed.
  A device's first look, though, counts every note already out as shown,
  and starts its games' updates after every one already out,
  so a new phone opens with no box (`listNotesToShow` and `readOrStartSeenAt` in `shared/page/updates.js`).
  Add a note only when the user asks for one, whatever the PR's type, in the words they approve, with an `at` just before the PR merges.
  A word that should stand out, like a button's name, goes in `<b>`,
  in a note built with the `html` template, which the Updates box sets at 500, heavier than the note's text, as it does a final's team names.
- A Diagnostics report, which a viewer shares wherever they like, carries none of what AGENTS.md's public-repo bullet keeps out of the repo:
  each of its logs names a file by its own name and the page as page (`nameFile` in `shared/page/step-log.js`).
- Search finds every place the app has, as the phone's own search does: each tab,
  sheet, sheet section, and setting, and each kind of thing with a page of its own,
  like a team or a player, and a coach once coaches have pages.
  Anything a change adds that a fan could look for is searchable, in words a fan would type, unless there's a reason to leave it out.
- When you add a place, make it searchable in the app's `page/js/search-pages.js`,
  with its row, its words, and what it opens, and add it to `COVERAGE` in the app's `tests/search.test.js`,
  with the search that finds it, or with why search leaves it out.
  That test reads the page's markup and fails on any tab, sheet,
  sheet section, or setting `COVERAGE` doesn't name, on any setting's row without the `data-setting` its search opens, and on any search that no longer finds its place.
  A kind of thing whose pages share one sheet, like a player's, is named once, by a search that finds one of them.
