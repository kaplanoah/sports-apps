---
name: add-league
description: How to add a new league to the repo as a new app, in parts, starting from the WNBA's
---

# Adding a league

A new league is a new app.
Copy the WNBA's: it was built on the shared code from its start,
while MLB still carries pieces from before it, and every file below has a working example in `apps/wnba/`.

A league ships in parts.
Its first PR holds what a fan opens the app for, by the steps below:
the Worker and its store, the Games tab, the standings and bracket,
each game's sheet with its box score, each team's sheet with its numbers,
search, settings, the gate, the page's copy on the phone, both themes, and the beta channel.
Each later PR adds one more of the WNBA's parts, copying it,
like rosters and players' sheets, a final's Highlights, a game's preview and lead chart,
the News tab and its notifications, or the Updates box,
with its tests and its places in search.

While a league is being built, a sandbox Worker may try its feeds from Cloudflare,
since a league can answer Cloudflare differently than it answers a cloud session.
Name it `<app>-sandbox`, upload it from a scratch folder outside git with Cloudflare's API, as `worker/deploy.mjs` does,
and give it no page, store, key, or secret.
Delete it once the app's first PR merges.

1. **Worker config.** `apps/<app>/worker/wrangler.toml` names the Worker `<app>-app`,
   binds the store and the gate's rate limit, and names the beta channel's Worker `<app>-app-beta` under `[env.beta]`,
   as the WNBA's does, which the root's `tests/deploy.test.js` checks for every app.
   The tooling finds apps by this file, and `package.json`'s `#page-files/*` import,
   the lint, type, and dead code globs, and Playwright's projects all pick the new folder up from `apps/*`.
   Add `worker/page-files.mjs`, a one-line call to the root's `readPageFiles`.
2. **The league's data.** `page/js/snapshot.js` names the league's feeds and turns their answers into one snapshot:
   `buildSnapshot(responses, { season, now })`, with the season's games,
   series, and standings and a `missing` list of feeds that didn't answer,
   and `choosePollDelay(snapshot, now)`, which hands the shared one in `shared/page/poll-schedule.js` whether a game is live, the starts still to come, and the league's live pace.
   It runs in both the page and the Worker, so it uses no DOM and no globals.
3. **Reading the feeds.** `worker/src/snapshot.js` fetches them with `createSnapshotLoader()`,
   reading each slow feed again only as a game ends or once it's old,
   and keeping its last good answer for when a read fails, with the shared `createFeedKeeper` in `shared/worker/feed-keeper.js`.
4. **Keeping the season.** `worker/src/season-updater.js` saves each snapshot into the store,
   leaving a field as it was when a feed it needs didn't answer, and lists the notifications for what's new.
   `worker/src/store.js` hands those functions to the shared store with `createSeasonStore(league)`.
   `worker/src/index.js` builds the Worker with `createAppWorker` and exports the store's class.
5. **The page.** `index.html` keeps the shared tab bar and settings markup, its element IDs, and the import map for `#shared/`.
   Its Games view is one empty `#seasonGames`, which `startDayStrip()` wires and `fillDayStrip()` fills with the league's game days.
   It loads the same shared stylesheets and scripts as the WNBA's, in the same order,
   around its own `styles.css`, which sets every token their top comments list,
   and calls `openLastTab()`, `showLastDrawn()`, `followSeasonPart()`, `watchSlowLoad()`, and `drawHomeScreenAsks()` right after its views and sheets,
   in that order, so a part on the shown tab can take back its sideways scroll, the header rides as far as the season's part put back,
   and the welcome opens over any sheet put back.
   Its `gate.html`, which asks for the access code, and its `sw.js`, which sets `self.pageName`,
   load the same shared files as the WNBA's too, which the root's `tests/apps.test.js` checks.
   It marks each element its code draws whole, like `#bracketWrap` and `#stamp`,
   with `data-last-drawn`, and keeps the empty `#loadNote` above its views.
   Give it a manifest, icons, and an `apple-mobile-web-app-title` of the league's short name,
   which its manifest's `name` and `short_name` match.
   Agree on the league's look with the owner from a mockup first: its fonts,
   self-hosted in `page/fonts/`, with each type role's size and weight set in its `:root`, as `.claude/rules/page-look.md` says,
   and its light and dark themes, each a set of colors, the dark one under `:root[data-theme="dark"]`,
   with an icon and a bar color of its own, which `page/js/looks.js` hands the shared `appearance.js`
   for the page and, through `page/js/gate-theme.js`, for the gate.
   Choose the league's All-Star colors with the owner too: each All-Star team's star takes its uniform's color,
   as the WNBA's orange West and white East do, its visitors orange and its home team white in a year of captains' teams,
   and MLB's American and National League colors do, through `renderAllStarMark` in `shared/page/all-star.js`,
   and `styles.css` sets the star's tokens that `game-row.css` lists from the league's own dot.
   `page/js/league-words.js` names what the league's fans call things and the words its pages never show,
   as "Writing" in AGENTS.md says, and its search terms hand it to the shared search as `words`.
6. **Tests.** Record a real afternoon of the league's feeds as a fixture in `tests/fixtures/`,
   and test the snapshot, the Worker, the season updater, and the page's views against it.
   Copy each of the WNBA's tests of what the PR builds, since they run the shared checks:
   its browser harness, which runs the page against the real store,
   `page.spec.mjs`, `themes.spec.mjs`, and `role-looks.spec.mjs`,
   which check every view for type roles, contrast, periods, words, taps, and theme layout,
   the last two walking the views listed in `tests/browser/views.mjs`,
   `at-rest.spec.mjs`, which runs in WebKit too,
   and `release-check.spec.mjs`, `access.spec.mjs`, and `offline.spec.mjs`.
   Its `tests/search.test.js` names each place in `COVERAGE`, as "Search finds every place" in AGENTS.md says,
   and its `tests/search-typing.test.js` types every team, place, and player with the root's `tests/search-sweep.js`,
   from a recorded list of the league's players.
   Each sheet joins `sheet-stack.spec.mjs` and `sheet-reload.spec.mjs` in the PR that adds it.
   Hand the deploy each channel's page secrets in `.github/workflows/deploy.yml`,
   and the `Watch apps` workflow production's in `watch.yml`, which the root's `tests/deploy.test.js` checks.
7. **Docs.** Add the app to the README's table and its setup section's list of apps, and give it a `.claude/rules/<app>.md` of its own, as `mlb.md` and `wnba.md` are,
   and name it beside them in AGENTS.md's list of rule files.
8. **Ship it.** Open it as a `feat:` PR, which starts the app at version 1.0.0.
   Its page adds lines that give parts layers of their own, so it's a red change,
   tried on the owner's phone from beta before it merges, as "Workflow" in AGENTS.md says.
   Each channel's token can edit only the Workers it names, so before the first deploy of each channel,
   the owner creates its Worker in Cloudflare's dashboard and adds it to that environment's token:
   `<app>-app-beta` to the `beta` token before the first push to `beta`, and `<app>-app` to the `production` token before the merge.
   Once its CI passes, push it to `beta`, whose deploy replaces `<app>-app-beta`,
   which answers nothing but `robots.txt` and `health` until `npm run set-app-key -- <app> --channel beta` gives it a key and prints its address.
   Give the owner that address, and ask them to set its code with `npm run set-access-code -- <app> <code> --channel beta`,
   add both as `<APP>_BETA_PAGE_URL` and `<APP>_BETA_ACCESS_CODE` in the `beta` environment's secrets,
   add the page to the Home Screen, and label the PR `phone-ok` once they've used it.
   The merge's deploy then replaces `<app>-app`, which `npm run set-app-key -- <app>` gives its key in the same way,
   and the owner adds its address and code as `<APP>_PAGE_URL` and `<APP>_ACCESS_CODE`,
   so each deploy and the `Watch apps` workflow open its page.
