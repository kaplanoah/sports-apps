---
paths:
  - "apps/*/worker/**"
  - "shared/worker/**"
  - "services/*/worker/**"
  - "services/*/tests/**"
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
  It also says, under `services`, whether each service it binds answers and at which release, asked as seldom,
  apart from its own status, so an app whose service is down still answers 200.
  An alarm in its Durable Object (`worker/src/season-updater.js`) keeps the current season's saved data up to date from the league,
  less often while no page has its socket open, and a page that opens brings the next update forward; the page only reads it.
  The store tells a page as its socket opens whether that update is coming, and tells every page when each update is done, even one that changed nothing.
  When the Worker has an `ACCESS_CODE` secret, the page's address shows the app's `page/gate.html`,
  built from the shared `gate.js` and `gate.css`, and the season's data answers 401 until the phone sends that code.
  The Worker keeps the phone signed in with a cookie that holds a signature over the code, made with the `ACCESS_SIGNING_KEY` secret,
  never the code itself or the page's key, which every link shows (`shared/worker/access-gate.js`).
  A 401 reloads the page (`shared/page/access.js`).
  The Home Screen app's link to add the site again, whose browser keeps its cookies apart from the app's,
  signs the browser in with a handoff the Worker makes for a phone signed in,
  and opens the page at its own address without the handoff (`serveHandoff` in `shared/worker/access-gate.js`).
  A handoff is good for ten minutes under the code it was made under.
  The app asks for a handoff as settings shows the note on updating the icon, and again halfway through while it does,
  or as it comes back once that's past, since a phone freezes its timers while it's away (`shared/page/appearance.js`).
  An app that hands `createAppWorker` its `isMovingToPageHost` moves its page from under the key to the `PAGE_HOST` address,
  while the Worker has both that secret and a code.
  Under the key, a phone signed in gets a handoff at `PAGE_HOST` from `access/move` (`serveMoveHandoff`),
  and the page's address answers a phone that never signed in with a 301 to the same page there, which no browser keeps.
  Each update's news goes out as Web Push notifications (`worker/src/notifications.js`,
  `shared/worker/push.js` and `web-push.js`, and `page/sw.js`);
  the Durable Object makes and keeps the signing key itself, under a key the store's paths can't name.
  The same service worker, which every load registers (`shared/page/service-worker.js`),
  keeps a copy of the page and every file it loads, and the pictures from other sites,
  like the News photos, that the page last showed (`shared/page/offline-worker.js`).
  So the page opens from the phone at once, even offline, while a newer page downloads behind it and replaces the copy only once all its files have arrived,
  and a page a deploy replaced reloads only once it has (`refreshPageCopy`).
  A copy the phone can't read leaves each request to the Worker, as if there were none,
  so a phone whose storage fails still opens the page whenever the Worker can answer.
  The service worker keeps its last steps, each start, install, activation, and push,
  and each page it opened and how, in a cache of its own,
  for Diagnostics to show (`shared/page/service-worker-steps.js`, read by `service-worker.js`).
  A phone the Worker signs out drops the copy (`shared/page/access.js`).
  Browser tests block service workers, whose requests skip the tests' routes, unless a test is about one.
  Deploys bundle it with all of the app's `page/` but a tuning round's `page/tuning-round.json`,
  which a channel off production writes into the page instead (the root's `worker/tuning-files.mjs`);
  `npm run build` writes each app's bundle to its `worker/dist/`, which git ignores.
  The build points the page's stylesheets, scripts, and import map into a folder named for its commit (`pinPageFiles` in the root's `worker/page-files.mjs`),
  which only that release's Worker serves, and browsers keep for good,
  so a page loaded mid-deploy never runs two releases' files together;
  when one is missing, `shared/page/release-guard.js`, written into the page's head, reloads it.
  The build also writes the release into the page, with beta's tag beside the app's name,
  so the page shows them as it opens, without asking the Worker (`writeRelease`).
- Read ahead of the page.
  What a view or sheet shows from a league, the store reads in the background and keeps,
  so a tap reads only the store and never waits on the league,
  as the WNBA's players and rosters do (`worker/src/player-updater.js`).
  Keep that reading lean.
  Read only what may have changed, with the shared `createFeedKeeper`,
  a feed that changes with games as a game ends and any other once it's old.
  Read a whole league in one request rather than one per player or team.
  Keep each answer trimmed to the columns the page reads.
  Save only the documents that changed.
  Read a finished season once and never again.
  Fill past seasons a little at a time, newest first.
  A test counts the requests each run makes, as the WNBA's `tests/player-updater.test.js` does, so a change that reads more than it needs fails.
  The Worker reads the league on a tap only for what the store doesn't keep.
- The `accounts` service (`services/accounts/`):
  a Worker with no page or address, which each app reaches by its `ACCOUNTS` binding with RPC calls on its default export.
  Its one Durable Object keeps each account under a random id, with only its passkeys, keyed hashes of its emails, and each app's choices.
  It never keeps a name or an email as typed: an email is an HMAC under the service's own `EMAIL_KEY` secret (`worker/src/email-hash.js`).
  A choice saved keeps its write time, and the latest write wins (`worker/src/choices.js`).
  Its calls start and finish a passkey's registration and sign-in, read and save choices, remove a passkey, and delete the account,
  and they check passkeys with `@simplewebauthn/server` (`worker/src/accounts.js`).
  Every app's passkeys belong to the one site the service's `RP_ID` secret names, so a passkey made on one app signs in on the others,
  and its finishing calls take the origin of the caller's page, which the service trusts since only the apps' bindings reach it.
  Its health says it isn't ok while it lacks `EMAIL_KEY` or `RP_ID`, naming the secret and never a value (`worker/src/health.js`).
  The logic takes the store's storage, so a Node test runs each call against a fake authenticator (`tests/fake-authenticator.js`).
