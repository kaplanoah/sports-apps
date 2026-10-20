---
paths:
  - "worker/**"
  - ".github/**"
  - ".claude/hooks/**"
  - ".claude/settings.json"
---

# Tooling

- Tooling: the root `worker/` builds, versions, deploys, and rolls back every app,
  and tells a red change for CI's gate, and comments on each open pull request a merge to main leaves in conflict,
  from its own `Conflicts` workflow.
  Its code for these is in `apps.mjs`, `build.mjs`, `deploy.mjs`,
  `deploy-scope.mjs`, `flag-conflicts.mjs`, `red-change.mjs`, `release.mjs`,
  `rollback.mjs`, `set-app-key.mjs`, `set-access-code.mjs`, `set-page-host.mjs`, the secrets calls they share in `worker-secrets.mjs`,
  and the channels each command's `--channel` names in `channels.mjs`.
  Its tests are in the root `tests/`.
  It opens each app's live page as a phone does, signed in with its code, and says whether it drew what its store sent (`check-page.mjs`).
  Each deploy does this for its new version, putting the one before back when it doesn't.
  The `Watch apps` workflow does it every 15 minutes,
  keeping one open issue for each app that isn't opening, which closes once it opens again,
  and one for each that opens without asking for its code, which closes once it asks again (`watch-apps.mjs`).
  The deploy and the workflow both read each page's address and code from the `production` environment's secrets, as `<APP>_PAGE_URL` and `<APP>_ACCESS_CODE`,
  and a beta deploy reads them from the `beta` environment's, with `_BETA` after the app's name.
- A hook in `.claude/settings.json` blocks a call that starts with `cd`, a subshell's `(cd` too,
  or joins commands with `&&`, `||`, `;`, a lone `&` that runs one in the background, or a line break,
  in the call itself or in a script it hands a shell as a string, as `bash -c "a; b"` does (`.claude/hooks/one-command.mjs`).
- Another hook there hands a session off to a fresh one as its context grows, measured from its transcript's last reply (`.claude/hooks/context-limit.mjs`).
  At 200k tokens it asks the session to hand off at its next break, with each prompt and at each 10k after.
  At 300k it blocks every call but what a handoff needs:
  reading, committing and pushing the session's own branch, writing the PR's description, replying on the PR, merging it, and reading its Deploy runs.
  It lets a subagent's calls through, and any call when it can't read the transcript.
  CI's review turns hooks off.
- `npm run rollback -- <app>` puts the app's previous version back at all of its traffic and prints which commit was live and which is now.
  Run it only when the user asks.
- `npm run set-app-key -- <app>` gives that app's Worker its `APP_KEY` and prints the page's address.
  `--rotate` replaces the key, which changes the address; do that only when the user asks.
- `npm run set-access-code -- <app> <code>` sets the code an app's page asks for, with a new random `ACCESS_SIGNING_KEY`; the user picks the code.
  A new code signs every phone out, and `--remove` stops asking.
  Never commit, log, or post the code.
- `npm run set-page-host -- <app> <host>` points a host on a domain in the Cloudflare account at that app's Worker and names it in the Worker's `PAGE_HOST` secret,
  so the page also opens there without its key, behind its access code, which it needs first; the user picks the host.
  The address with the key keeps working as it was, and phones stay signed in there.
  Keep the host out of the repo, as the Worker's own address is.
- Mask, in anything a workflow logs or posts, what AGENTS.md's public-repo bullet keeps out of the repo,
  as `hideAddress` in the root's `worker/check-page.mjs` masks a check's reason.
- An app's deploy is skipped when nothing but docs, tests, tooling,
  and other apps' folders changed since its live version's commit; the root's `worker/deploy-scope.mjs` lists those files.
  When you add a file that can't change the Worker, add it to that list.
