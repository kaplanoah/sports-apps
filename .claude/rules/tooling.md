---
paths:
  - "worker/**"
  - ".github/**"
  - ".claude/hooks/**"
  - ".claude/settings.json"
---

# Tooling

- Tooling: the root `worker/` builds, versions, deploys, and rolls back every Worker, each app's and each service's, tells a red change for CI's gate,
  and keeps beta to one pull request at a time, as the `ship` skill's "The beta channel" says.
  `ls worker/` lists its modules, and its tests are in the root `tests/`.
  It opens each app's live page as a phone does, signed in with its code, and says whether it drew what its store sent (`check-page.mjs`).
  Each deploy does this for its new version, putting the one before back when it doesn't.
  The `Watch apps` workflow does it every 15 minutes,
  keeping one open issue for each app that isn't opening, which closes once it opens again,
  and one for each that opens without asking for its code, which closes once it asks again (`watch-apps.mjs`).
  The deploy and the workflow both read each page's address from the `production` environment's secrets, as `<APP>_PAGE_URL`,
  and the one code every app asks for as `ACCESS_CODE`.
  A beta deploy reads them from the `beta` environment's, with `_BETA` after the app's name in each address's.
- Services: each deploy uploads every service before any app, since an app binds each service, by its name in capitals, to its Worker on the app's channel (`listServiceBindings` in the root's `worker/deploy.mjs`).
  A service has no workers.dev address, so its deploy reads what each app's `health` says of it,
  in a field of its own, `services.<name>`, apart from the app's own status,
  and puts the service's earlier version back unless every app that reports it says it's ok at the new commit (`worker/check-service.mjs`).
  No app reports a service until its live version binds it, so a service's first deploy logs that the check was skipped.
  The service reads its release from its `VERSION` binding, which the upload's `workers/tag` sets to the short commit.
  The `Watch apps` workflow checks each service the same way, keeping one open issue for each that isn't answering, which closes once it answers again.
  Each channel's Cloudflare token edits only the Workers it names, so before a service's first deploy on a channel,
  the owner creates its Worker and adds it to that environment's token, as the `add-league` skill says for an app.
- Hooks in `.claude/settings.json`, each saying why when it blocks a call, and all off in CI's review:
  - `.claude/hooks/one-command.mjs` blocks a call that starts with `cd` or joins commands.
  - `.claude/hooks/context-limit.mjs` hands a session off to a fresh one as its context grows.
  - `.claude/hooks/install-packages.mjs` runs `npm ci` as a session starts when `node_modules` is out of date.
  - `.claude/hooks/check-push.mjs` runs lint, format, types, and dead code before each `git push`.
- A session runs `deploy:api`, `rollback`, and each `set-` script itself, in the cloud environment that holds the Cloudflare token,
  and the owner approves each when `.claude/settings.json` asks.
  Never hand the owner one to run on their own computer, which has neither the token nor the account ID,
  unless they ask to.
- `npm run rollback -- <worker>` puts an app's or a service's previous version back at all of its traffic and prints which commit was live and which is now.
  Run it only when the user asks.
- `npm run set-app-key -- <app>` gives that app's Worker its `APP_KEY` and prints the page's address.
  `--rotate` replaces the key, which changes the address; do that only when the user asks.
- `npm run set-access-code -- <app> <code>` sets the code an app's page asks for, with a new random `ACCESS_SIGNING_KEY`; the user picks the code.
  Every app on a channel takes the same code, since the deploy and the workflow sign each in with the environment's one `ACCESS_CODE`.
  A new code signs every phone out, and `--remove` stops asking.
  Never commit, log, or post the code.
- `npm run set-page-host -- <app> <host>` points a host on a domain in the Cloudflare account at that app's Worker and names it in the Worker's `PAGE_HOST` secret,
  so the page also opens there without its key, behind its access code, which it needs first; the user picks the host.
  The address with the key keeps working, and phones stay signed in there,
  but for an app moving to its own address, which sends its fans on there with their choices (`shared/page/page-move.js`).
  Keep the host out of the repo, as the Worker's own address is.
- `npm run set-email-key` gives the accounts service the `EMAIL_KEY` secret it hashes each email under, made at random and never printed, with `-- --channel beta` for beta's.
  It refuses when the Worker already has one, since a new key would leave every account's email unfindable.
  Run it once on each channel, once the service's Worker exists and the channel's token can edit it, before the service's first deploy there, which keeps it.
- `npm run set-rp-id -- <domain>` names, in the accounts service's `RP_ID` secret, the site every app's passkeys belong to, with `--channel beta` for beta's.
  It's a domain each app's `PAGE_HOST` on that channel is under, since the service checks each passkey against the origin of the caller's page.
  It never prints the domain, and refuses when the Worker already has one, since a passkey signs in only to the site it was made under.
  The owner picks the domain; run it once on each channel, beside `set-email-key`; keep the domain out of the repo, as the page hosts are.
- Until the accounts service has both secrets, its health says it isn't ok, naming the secret missing, and registration and sign-in refuse.
- Mask, in anything a workflow logs or posts, what AGENTS.md's public-repo bullet keeps out of the repo,
  as `hideAddress` in the root's `worker/check-page.mjs` masks a check's reason.
- A Worker's deploy is skipped when nothing but docs, tests, tooling,
  and other Workers' folders changed since its live version's commit; the root's `worker/deploy-scope.mjs` lists those files.
  It skips the root's `.claude/` folder whole, so a new hook, rule, or skill needs no entry.
  When you add any other file that can't change the Worker, add it to that list.
  A service's `wrangler.toml` deploys that service and every app, since each app binds the service by it,
  so adding, renaming, or removing one deploys them, but no other service.
