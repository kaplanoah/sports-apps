---
paths:
  - "apps/*/worker/**"
  - "shared/worker/**"
  - "apps/*/page/gate.html"
  - "apps/*/page/sw.js"
  - "shared/page/access.js"
  - "shared/page/appearance.js"
  - "shared/page/gate.js"
  - "shared/page/gate.css"
  - "shared/page/service-worker.js"
  - "shared/page/offline-worker.js"
  - "shared/page/service-worker-steps.js"
  - "shared/page/release-guard.js"
  - "worker/build.mjs"
  - "worker/page-files.mjs"
  - "apps/*/tests/*-updater.test.js"
---

# The Workers

- Worker:
  `worker/src/`.
  It serves the page, its store, and its sheets' reads, only under `/<APP_KEY>/`; everything but `robots.txt` and `health` is a 404 without the key,
  but at the address its `PAGE_HOST` secret names, where it serves them without the key, behind the access code alone,
  and so only while it has one (`findAppPrefix` in `shared/worker/app-worker.js`).
  `health` says whether the Worker and its store answer, 200 or 503 with the release's commit,
  so an uptime monitor can watch it without holding a secret, and asks the store once a minute at most however often it's hit (`shared/worker/health.js`).
  An alarm in its Durable Object (`worker/src/season-updater.js`) keeps the current season's saved data up to date from the league,
  less often while no page has its socket open, and a page that opens brings the next update forward; the page only reads it.
  When the Worker has an `ACCESS_CODE` secret, the page's address shows the app's `page/gate.html`,
  built from the shared `gate.js` and `gate.css`, and the season's data answers 401 until the phone sends that code,
  which the Worker keeps in a cookie signed over the code with the `ACCESS_SIGNING_KEY` secret,
  never the page's key, which every link shows (`shared/worker/access-gate.js`); a 401 reloads the page (`shared/page/access.js`).
  The Home Screen app's link to add the site again, whose browser keeps its cookies apart from the app's,
  signs the browser in with a handoff the Worker makes for a phone signed in,
  good for ten minutes under the code it was made under,
  which the app asks for again halfway through while settings stays open,
  or as it comes back once that's past, since a phone freezes its timers while it's away (`shared/page/appearance.js`),
  and opens the page at its own address without it (`serveHandoff` in `shared/worker/access-gate.js`).
  Each update's news goes out as Web Push notifications (`worker/src/notifications.js`,
  `shared/worker/push.js` and `web-push.js`, and `page/sw.js`);
  the Durable Object makes and keeps the signing key itself, under a key the store's paths can't name.
  The same service worker, which every load registers (`shared/page/service-worker.js`),
  keeps a copy of the page and every file it loads, and the pictures from other sites,
  like the News photos, that the page last showed (`shared/page/offline-worker.js`),
  so the page opens from the phone at once, even offline, while a newer page downloads behind it and replaces the copy only once all its files have arrived,
  and a page a deploy replaced reloads only once it has (`refreshPageCopy`);
  a copy the phone can't read leaves each request to the Worker, as if there were none,
  so a phone whose storage fails still opens the page whenever the Worker can answer;
  the worker keeps its last steps, each start, install, activation, and push,
  and each page it opened and how, in a cache of its own,
  for Diagnostics to show (`shared/page/service-worker-steps.js`, read by `service-worker.js`);
  a phone the Worker signs out drops the copy (`shared/page/access.js`).
  Browser tests block service workers, whose requests skip the tests' routes, unless a test is about one.
  Deploys bundle it with all of the app's `page/`; `npm run build` writes each app's bundle to its `worker/dist/`, which git ignores.
  The build points the page's stylesheets, scripts, and import map into a folder named for its commit (`pinPageFiles` in the root's `worker/page-files.mjs`),
  which only that release's Worker serves, and browsers keep for good,
  so a page loaded mid-deploy never runs two releases' files together;
  when one is missing, `shared/page/release-guard.js`, written into the page's head, reloads it.
- Read ahead of the page.
  What a view or sheet shows from a league, the store reads in the background and keeps,
  so a tap reads only the store and never waits on the league,
  as the WNBA's players and rosters do (`worker/src/player-updater.js`).
  Keep that reading lean: read only what may have changed, with the shared `createFeedKeeper`,
  a feed that changes with games as a game ends and any other once it's old;
  read a whole league in one request rather than one per player or team;
  keep each answer trimmed to the columns the page reads; save only the documents that changed;
  read a finished season once and never again; and fill past seasons a little at a time, newest first.
  A test counts the requests each run makes, as the WNBA's `tests/player-updater.test.js` does, so a change that reads more than it needs fails.
  The Worker reads the league on a tap only for what the store doesn't keep.
