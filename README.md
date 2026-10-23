# Sports Apps

[![CI](https://img.shields.io/github/actions/workflow/status/kaplanoah/sports-apps/ci.yml?branch=main&label=CI&logo=github&logoColor=white)](https://github.com/kaplanoah/sports-apps/actions/workflows/ci.yml)

Private web pages that follow a league all year, one app per league. Each app is its own page and Cloudflare Worker, in its own folder under `apps/`, and they share code in `shared/` and the tooling that builds, tests, and deploys them.

| App  | Folder       | Worker     |
| ---- | ------------ | ---------- |
| MLB  | `apps/mlb/`  | `mlb-app`  |
| WNBA | `apps/wnba/` | `wnba-app` |

### MLB

A private web page that follows the MLB season, from spring training through the World Series. It shows the standings, the postseason bracket (projected from the standings until the field is set), your ranking of who you want to win the World Series, every game of the season, the All-Star Game too, from Opening Day to the World Series, under a strip of its days, each with its starting pitchers and, away from today, each team's record as of the game, and scores that update automatically. Tap a team's name for its sheet: its place in each race, its next game, how far it's gone in the postseason, and every World Series it has won. Tap the rest of a game to compare its starters: how they rank among the season's qualified starters, what they throw, and how their last starts went. A game later today whose club hasn't named its starter says "TBD" and opens to who started for that club lately and how rested each would be.

A Cloudflare Worker serves the page, and each device keeps its own ranking. It also reads MLB on its own, every 30 seconds during games, and every 15 from the 9th inning on, while the page is open, and a little less often while it isn't, so the standings and updates stay current even with the page closed, and sends the page each new score. Saved to an iPhone's home screen, the page opens full screen like an app, and can send a notification when something happens to a team in your ranking.

It also reads the news from ESPN, The Athletic, MLB Trade Rumors, Baseball Prospectus, and Joe Posnanski, and, for the Mets, NY Post, The Athletic, MLB.com, SNY, the Daily News, Amazin' Avenue, and MLB Trade Rumors, every 15 minutes by day and hourly overnight, and has Claude keep the Mets' news and the news that matters across baseball, and group the stories by topic. The News tab shows them as the WNBA's does. Settings can leave out the Mets' own beat writers and The Athletic; each device keeps its own.

### WNBA

A private web page that follows the WNBA season. It shows the playoff bracket, every game of the season, the All-Star Game too, from opening day to the last, under a strip of its days, with live scores and clocks, and the league and conference standings with the playoff line and, once the field is set, each team's first round and where its run stands. Tap a team's name or dot anywhere, even inside a game, for its season: its conference, seed, and record, its scoring, home and road records, top scorer, titles, and how far it got in the playoffs. Tap a game for its details: which channels it's on, or was; once it starts, its points by quarter, a chart of the lead through the game, the two teams' stats side by side, and each team's top scorers; before it does, the two teams' meetings this season, how their seasons compare, and each team's leading scorers. On a phone or tablet, an Updates box under the tabs lists each playoff game that went final since you first opened the app or last dismissed the box, and where its series stands, and under New in the app, any feature worth a note; each device keeps when its box counts from, its first open or its last dismissal. It follows the phone's dark or light setting, or the one you pick in its settings. Added to the home screen, it keeps the icon of the look it had then.

A Cloudflare Worker serves the page and reads the WNBA's own feeds on its own, every 15 seconds during games, and every 5 in the last 5 minutes of the 4th quarter and in overtime, while the page is open, and a little less often while it isn't, and ESPN's for where each game is on. If the WNBA stops sending scores, ESPN's stand in. It also reads the news from ESPN, The Athletic, The IX, Winsidr, and, for the Liberty, NY Post and NetsDaily, every 15 minutes by day and hourly overnight, and has Claude keep the stories worth reading and group them by topic. The News tab shows a card for each topic from the past week, with its lead story and the one that adds the most, each a headline, a short summary, and who wrote it, linking to the outlet's site. Settings can leave out the Liberty's own beat writers and The Athletic, whose stories mostly need a subscription; each device keeps its own. Saved to an iPhone's home screen, the page opens full screen like an app, and can send a notification with the score when any playoff game ends.

### Sharing a page

To share either page, give it an access code. Anyone who opens the link types the code once, and the phone remembers it.

## Setup (for humans)

Open [Claude Code on the web](https://claude.ai/code), paste this prompt, and follow Claude's instructions.

```
Set up the MLB tracker from https://github.com/kaplanoah/sports-apps
for me. Clone it (branch main), read the "Setup (for Claude Code)"
section of its README, and guide me through it one step at a time.
```

Claude deploys the page to Cloudflare and gives you its private address. It takes about ten minutes.

**You'll need** a Claude plan that includes Claude Code on the web and a free [Cloudflare](https://dash.cloudflare.com/sign-up) account. Claude walks you through the Cloudflare part.

Running the page doesn't cost anything. It runs on Cloudflare's free tier, and the scores come from the leagues' free public feeds. Keeping it updated doesn't use Claude.

## Setup (for Claude Code)

Guide the user one step at a time. Tell them the one thing to do next, wait until they say it's done, then go on. Don't ask them to make choices you can make for them. Never ask for the Cloudflare token in the chat.

Set up the app they asked for, by its folder under `apps/`: `mlb` for the MLB tracker, `wnba` for the WNBA tracker. Below, `<app>` is that folder, and `<worker>` is the `name` in its `apps/<app>/worker/wrangler.toml`.

**1. Get this session ready to deploy.** If `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_WORKERS_SUBDOMAIN` are set and `curl -s https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain` returns `"success":true`, go to step 2. Otherwise start with something like: "I'll walk you through adding a few things to this cloud environment so I can deploy the page for you. If you'd rather deploy it yourself from a terminal, just let me know." Then go through the steps below. If they want to deploy it themselves, see "If they deploy it themselves" below.

1. Have them sign in at [dash.cloudflare.com](https://dash.cloudflare.com) and open **Workers & Pages**. A free account is fine. If it asks for a workers.dev subdomain, have them pick one and tell you what it is.
2. Have them create an account token at **Manage account > Account API tokens > Create Token**, never a user token from **My Profile**, with the **Edit Cloudflare Workers** template, scoped to their account. Skip IP filtering because cloud sessions don't have a fixed address. A one-week expiry is enough. They copy the token but don't paste it into the chat.
3. Have them find their **Account ID** and workers.dev **Subdomain** in the right-hand column of the Workers & Pages overview.
4. In Claude Code, have them open this session's cloud environment (the environment menu in the title bar > **Edit**) and set:
   - **API credentials > Add credential**: type Bearer, allowed website `api.cloudflare.com`, header `Authorization`, prefix `Bearer`, and the token as the value. Then **Connect**. Sessions can use it but can't see it.
   - **Environment variables**: `CLOUDFLARE_ACCOUNT_ID=<their account id>` and `CLOUDFLARE_WORKERS_SUBDOMAIN=<their subdomain>`, the part before `.workers.dev`.
   - **Network access**: Custom. Add `<worker>.<their-subdomain>.workers.dev` and keep the default package managers.

   Then **Save changes**.

5. Environment settings only apply to new sessions. Start one in the same environment on this repo's `main` with this prompt. Use the `create_session` tool if you have it. Otherwise have the user start it. `Continue setting up the MLB tracker: README "Setup (for Claude Code)", step 2.`

**2. Deploy the Worker.** Run `npm ci`, then `npm run deploy:api -- <app>`. It runs the tests, deploys the app from `main` exactly as it is on GitHub, and checks that the Worker answers. It keeps the Worker's address out of its output, because GitHub's deploy logs are public; step 3 prints it. It refuses uncommitted changes and anything that isn't `main`'s latest commit. The session's own branch works once it matches `main`. It sets `NODE_USE_ENV_PROXY=1` so Node sends its requests through the session's proxy, which adds the token. That needs Node 22.21 or later. The repo's `.claude/settings.json` has the user approve that command, and `set-app-key` below, and blocks the other ways to deploy.

**3. Give the page its address.** Run `npm run set-app-key -- <app>`. It gives the Worker a long random `APP_KEY` secret and prints the page's address, `https://<worker>.<subdomain>.workers.dev/<key>/`. The page and its saved data answer only there. Give the user the address and tell them to keep it private: anyone who has it can see and change the page. Never pass `--rotate` unless they ask. It replaces the key, which changes the address.

To share the page beyond the user, have them pick an access code and run `npm run set-access-code -- <app> <code>`, with the same code for every app on a channel, since the deploy's check signs each in with its environment's one. The page then asks for it before it opens, and each phone types it once. Case, spaces, and hyphens don't count. Running it again with a new code signs every phone out until it types the new one, and `--remove` stops asking. Never commit or post the code.

To give the page an address of its own, on a domain in the Cloudflare account, run `npm run set-page-host -- <app> <host>` once the page has a code. It points `https://<host>/` at the Worker, which opens the page there without the key, behind the code alone. The address with the key keeps working. While the Worker has both the host and a code, it marks the page there as moving and sends fans on with their choices: a browser at once, and a Home Screen app from a card in its Updates box. Keep the host out of the repo, as the Worker's own address is.

Each app's news needs an Anthropic API key, as its Worker's `ANTHROPIC_API_KEY` secret. Have the user add it themselves in the Cloudflare dashboard (the Worker's **Settings**, then **Variables and Secrets**, as a **Secret**), never in chat. Without it, the Worker still reads the feeds but keeps no story. `<address>store/news/status` says what the last run couldn't do, and counts Claude's calls and tokens by day.

**4. Check the page.** Have the user open the address. The first visit also starts the Worker's own updates. Then read `<address>store/live/status` with `curl`. If `data.error` and `data.write` are empty, it works. If not, `error` says why the Worker couldn't read the league, and `write` names the save that failed.

**5. Save it to the home screen.** On an iPhone, have them open the address in Safari and choose **Share > Add to Home Screen**. It then opens full screen with its own icon. On a phone, the page shows these steps itself, in a welcome over the whole screen until the page is added or the viewer goes on in the browser, and at the top of settings, and on Android its **Install** button opens Chrome's own install dialog.

**6. Turn on notifications.** From the home screen icon, have them tap the sliders at the top right to open settings, turn on **Notifications**, and allow them. iPhones send web notifications only to pages opened from the home screen. Each device turns them on for itself. A notification comes for each new update about a team in the ranking: a postseason game or series result, a clinch, an elimination, or a change in the field or seeds.

Finish by telling the user they can set their ranking in settings, below Notifications. If they made a Cloudflare token only for this setup, tell them they can delete it now, or remove the environment credential. The page keeps running without it. To deploy future changes on merge instead, see "Deploying on merge" below.

### If they deploy it themselves

Assume they're comfortable in a terminal. In their own clone of `main` they run `npx wrangler login`, then `npm run build -- <app>` and `npx wrangler deploy --config apps/<app>/worker/wrangler.toml`, which prints the Worker's address. Then they give it a key with `npx wrangler secret put APP_KEY`, pasting a long random value such as the output of `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`. The page's address is the Worker's address plus `/<key>/`. Then go on from step 4. They redeploy with the same two commands when the code changes.

Deploying from Cloudflare's dashboard isn't covered here, because the page's saved data needs the Durable Object binding and migration that `apps/<app>/worker/wrangler.toml` sets up. Cloudflare's tools change over time, so if something doesn't match, point them to Cloudflare's [Workers docs](https://developers.cloudflare.com/workers/).

## Making changes

`main` is what's deployed. Work on a branch and open a pull request into `main`. GitHub lints, checks formatting and types, looks for unused code, and runs the Node tests, and the browser tests of the apps a change reaches, on every pull request, so merge once those pass and the pull request has no conflicts with `main`. The trusted `pull_request_target` workflow reviews pull requests against their current base, including stacked pull requests, except Dependabot's, from main's copy of the controls. CI joins its result with read-only credentials and holds the merge until trusted review passes. Trusted review requires a `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` secret; without one, a ready pull request that needs review cannot pass `check`. Automatic asks are limited to branches in this repository and authors associated as OWNER, MEMBER or COLLABORATOR; other fork authors need a maintainer to add the `review` label. Review runs once a permitted pull request is ready, and again only when it's labeled `review`, never on a push alone. As [REVIEW.md](REVIEW.md) says, it splits the change into areas by what the files are about, and has one reviewer read each area in full, with the rule files in `.claude/rules/` whose paths match its files. REVIEW.md's [How to report](REVIEW.md#how-to-report) section says how the review checks and posts what it finds. The first review reads the whole change, and each review after it reads what changed since the last review that finished. A ready pull request's `check` fails until trusted review has passed on the code that merges, the pull request merged into its target branch. A review that can't run, that left a changed file or a rule file unread, or whose reviewers, check across areas, or posting step didn't finish, blocks the merge. Its findings don't fail the check; answer and resolve every finding as the [steward skill](.claude/skills/steward/SKILL.md) says. `main` merges only once every review thread is resolved.

A change that only an iPhone can test, like one to how the page's parts slide or layer, is a red change (`worker/red-change.mjs`). CI holds it on a `phone` status on its head commit, which stays pending until the owner has used it on the beta app and labeled the pull request `phone-ok`. The repo's ruleset for `main` (**Settings > Rules > Rulesets**) requires the `check` and `phone` statuses and every review thread resolved. Without `phone` in it, or for a pull request from a fork, whose token can't post the status, `check` holds a red change itself; a fork's pull request gets no `phone` status, so while the ruleset requires it, it merges only through the ruleset's bypass. The base branch's copy of the gate's code judges a pull request, so a change to that code can't let the pull request's own red change through; a change to the workflow's `gate`, `phone`, or `check` job is the review's to weigh, which `REVIEW.md` counts as Important when it lets less through.

A fork's build and test workflows run without the repo's secrets, using its own workflow definitions, which its author can change to pass. Trusted review can review fork pull requests after the maintainer gate above: it uses main's controls and review credentials, and reads fork files as data without executing their code, imports, or configuration. The repo's **Settings > Actions > General**, under **Approval for running fork pull request workflows from contributors**, is set to **Require approval for first-time contributors**. GitHub counts anyone without a commit merged into the repo as a first-time contributor, and only the owner merges, so a first-time contributor's build and test workflows wait for the owner's approval. Trusted review runs separately from those workflows.

To run the same checks yourself, run `npm ci` and `npx playwright install chromium` once, then `npm run check`. `npm run format` fixes formatting.

After `git fetch origin main`, run `npm run rework` for a file-overlap estimate of follow-up fixes and their monthly share. It reads the locally fetched `origin/main`, so a stale fetch gives a stale report and a missing reference fails the command. Overlap does not prove an earlier PR caused a fix.

Each app's Worker carries its page. Every deploy bundles both from the source it deploys, so there is nothing to rebuild by hand. `npm run build` writes each app's bundle to its `apps/<app>/worker/dist/`, which git ignores, if you want to look at it. The bundle records its version, the commit it was built from, and when, and the page's settings show them.

A service is a Worker with no page, in `services/<name>/`, which the apps reach by a binding and the public never does. It's built, versioned, deployed, and rolled back as an app is. The `accounts` service keeps each account's passkeys and the choices it saves in each app, and knows an email only by a keyed hash.

Code every app uses lives in `shared/`: the type roles every page's text takes, each app sizing and weighing them for its own fonts (`type.css`), the page's tab bar and settings sheet and the bar that asks a phone to add the page to the Home Screen (their styles in `chrome.css`), the sheet a tap on a game opens (`sheet.css`), catching up on return, showing what the page last showed while it loads, and store client in `shared/page/`, and the Worker's routing and push notifications in `shared/worker/`. A change there reaches every app. The root `worker/` holds the tooling every app shares: building, versioning, deploying, and setting the page's key. Tests for shared code and tooling are in the root `tests/`; each app's own tests are in its `tests/`.

Versions follow [semantic versioning](https://semver.org). Each pull request's title starts with a type: `feat:` for a new feature, `fix:`, `refactor:`, or `build:` for a patch, and `docs:`, `test:`, `ci:`, or `chore:` for changes that don't deploy. A `!` after a type that deploys, as in `feat!:`, marks a major change for each Worker it deploys; `feat(mlb)!:` makes it major for that Worker alone, and the others take the type's own bump. The build works out each Worker's version from these titles on `main`, so there are no tags to keep. A merge that changes nothing a Worker's deploy counts, like only its tests, docs, or other Workers' folders, leaves that Worker's version alone. Each Worker counts on from a baseline version in `worker/release.mjs`; a new one starts at 1.0.0 with the merge that adds its folder.

Every deploy checks that the Worker answers afterward. If it doesn't, the deploy puts the previous version back and fails. An open page reloads itself for a deploy the next time it comes back into view, and otherwise reads what changed while it was away, so a home-screen app never needs quitting to catch up. A page that loads again first shows what it last showed, so it doesn't flash empty while it waits for its data.

### Deploying on merge

GitHub can deploy each Worker, each app's page included, after each merge: at once when the pull request's checks passed on exactly the code `main` now has, which is when it was up to date with `main` as it merged, and otherwise once the checks pass on `main`. First create each app's live Worker, `<app>-app`, and each service's, named in its `wrangler.toml`, in Cloudflare's dashboard, since a token can be limited only to Workers that exist. Create each Worker from the **Hello World** starter, which the first deploy replaces, and leave **Protect with Cloudflare Access** off: the deploy checks each app's workers.dev address, and a service answers only its apps. Then, in the repo's **Settings > Environments**, create an environment named `production`, limit its deployment branches to `main`, and add:

- a secret `CLOUDFLARE_API_TOKEN`: a Cloudflare account token, made at **Manage account > Account API tokens > Create Token**, with the **Workers Scripts** permission at **Edit**, limited to each app's live Worker, `<app>-app`, and each service's, named in its `wrangler.toml`, with no IP filtering and a long expiry;
- a secret `CLOUDFLARE_ACCOUNT_ID`, so it stays out of the public deploy logs;
- a secret `CLOUDFLARE_WORKERS_SUBDOMAIN`: the account's workers.dev subdomain, the part before `.workers.dev`, which a token limited to its Workers can't read, and which the deploy builds each Worker's address from;
- for each app, a secret `<APP>_PAGE_URL` with its page's address, key and all, like `WNBA_PAGE_URL`;
- a secret `ACCESS_CODE` with the one code every app asks for, if they ask for one.

The beta channel (see "Trying a change on the phone" below) deploys from an environment of its own, named `beta`, limited to the `beta` branch, with the same secrets: a token limited to each app's beta Worker, `<app>-app-beta`, and each service's, from the `[env.beta]` in its `wrangler.toml`, the account ID and subdomain, beta's `ACCESS_CODE`, and each page's address with `_BETA` after the app's name, like `WNBA_BETA_PAGE_URL`. Since each token can change only its own channel's Workers, a branch pushed to `beta` can never reach the live apps.

Each deploy opens its new version's page as a phone does, signed in with its code, and puts the version before back when the page doesn't draw what its store sends. Every 15 minutes, the **Watch apps** workflow opens each app's page the same way and keeps one open issue for each app that isn't opening, which closes itself once the app opens again. An app without its page's secrets isn't opened, and the deploy log and the workflow say so. A page that asks for no code while its environment holds an `ACCESS_CODE` opens without it, and they say that too. The workflow also keeps one open issue for each live app that opens without asking for its code, which closes itself once the app asks again or the environment holds no `ACCESS_CODE`. A service has no address of its own, so each deploy and the workflow ask each app's health of it, and the workflow keeps one open issue for each service that isn't answering, which closes itself once it answers again.

Each deploy records its commit on the Worker's version. A merge skips a Worker's deploy when nothing but docs, tests, tooling, and other Workers' folders changed since its live version's commit, since its Worker would be the same, though a service's `wrangler.toml` deploys that service and every app, which binds the service by it, but no other service; `worker/deploy-scope.mjs` lists those files. A merge that main has already moved past skips too once CI has passed on the newer merge, whose deploy covers it, and deploys until then, in case that CI fails. A merge's deploy never puts back code older than the live version's; a push to beta replaces whatever beta held, but only with the head of the pull request that holds beta, as "Trying a change on the phone" says. Without the channel's token, each Deploy run fails with a missing-token error and deploys nothing. This failure is expected in a repository that has not configured deployment on merge. Redeploy by hand with `npm run deploy:api`, or `npm run deploy:api -- <worker>` for one app or service. `npm run rollback -- <worker>` puts its previous version back at all of its traffic and prints which commit was live and which is now; it refuses when there's no earlier version. A rollback keeps the Worker's secrets as they are.

Before the `accounts` service's first deploy on a channel, once its Worker exists and the channel's token can edit it, give it the key it hashes each email under with `npm run set-email-key`, or `npm run set-email-key -- --channel beta` for beta's. It makes the key at random and never prints it, and refuses to replace one, since a new key would leave every account's email unfindable.

Then name the site every app's passkeys belong to with `npm run set-rp-id -- <domain>`, or `npm run set-rp-id -- <domain> --channel beta` for beta's: a domain each app's page host on that channel is under. It never prints the domain, and refuses to replace one, since a passkey signs in only to the site it was made under. A deploy keeps both. Until the service has both, its health says it isn't ok, and registration and sign-in refuse.

### Trying a change on the phone

Each app also has a beta Worker, `<app>-app-beta`, named in the `[env.beta]` of its `wrangler.toml`, with its own store, key, and address. Its page names itself "beta" on the Home Screen, in its settings' version line, and in a tag beside its name with the commit it runs and how long ago that went live, so it can sit beside the real one. Beta holds one pull request at a time: the one labeled `beta` first. Others wait in line with `beta-wait`, and the `Beta` workflow comments on the one that has waited longest once beta is free. To use a pull request's change on the phone before it merges:

1. Merge `main` into its branch, push the branch, and label the pull request `beta`, taking `beta` off first if it's still there from before the push, since adding a label it already has changes nothing. Once it's the only open pull request labeled `beta`, it holds beta.
2. Reset `beta` to the pull request's branch and push it: `git push -f origin <branch>:beta`.
3. Wait for the Deploy run for that push to finish. It deploys the beta Workers at once, with the same checks and rollback as `main`'s deploy, and deploys nothing for a commit that isn't the head of the pull request holding beta.
4. Open the beta app from the Home Screen and use the change.

A pull request gives beta up as it closes or merges, as its branch is pushed, and as it's labeled `phone-ok`.

Before the first beta deploy, create each app's beta Worker, `<app>-app-beta`, and each service's in Cloudflare's dashboard, as "Deploying on merge" says, since the `beta` token can change only the Workers it names, then create the `beta` environment as "Deploying on merge" says, with its token limited to them. After the first one, give each beta Worker its key with `npm run set-app-key -- <app> --channel beta`, which prints its address, and, if the real page asks for a code, give it the code in the `beta` environment's `ACCESS_CODE` with `npm run set-access-code -- <app> <code> --channel beta`. Add the address to the `beta` environment's secrets, and add the page to the Home Screen from that address. `npm run deploy:api -- <worker> --channel beta` deploys beta by hand, from a checkout of `origin/beta`, and `npm run rollback -- <worker> --channel beta` rolls it back.

## License

[MIT](LICENSE)

The icons are from [Phosphor Icons](https://phosphoricons.com), used under the MIT license, copyright (c) 2023 Phosphor Icons.
