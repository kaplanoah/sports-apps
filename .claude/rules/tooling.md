---
paths:
  - "worker/**"
  - ".github/**"
---

# Tooling

- Tooling: the root `worker/` builds, versions, deploys, and rolls back every app,
  and tells a red change for CI's gate, and comments on each open pull request a merge to main leaves in conflict,
  from its own `Conflicts` workflow (`apps.mjs`, `build.mjs`, `deploy.mjs`,
  `deploy-scope.mjs`, `flag-conflicts.mjs`, `red-change.mjs`, `release.mjs`,
  `rollback.mjs`, `set-app-key.mjs`, `set-access-code.mjs`, `set-page-host.mjs`, the secrets calls they share in `worker-secrets.mjs`,
  and the channels each command's `--channel` names in `channels.mjs`); its tests are in the root `tests/`.
  It opens each app's live page as a phone does, signed in with its code, and says whether it drew what its store sent (`check-page.mjs`),
  which each deploy does for its new version, putting the one before back when it doesn't,
  and which the `Watch apps` workflow does every 15 minutes,
  keeping one open issue for each app that isn't opening, which closes once it opens again,
  and one for each that opens without asking for its code, which closes once it asks again (`watch-apps.mjs`),
  both from each page's address and code in the `production` environment's secrets, as `<APP>_PAGE_URL` and `<APP>_ACCESS_CODE`,
  and a beta deploy from the `beta` environment's, with `_BETA` after the app's name.
