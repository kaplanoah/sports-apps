import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readReviewGit } from "../worker/review-repository.mjs";
import { dispatchReviewTrial } from "../worker/review-trial.mjs";

/** @param {string} root @param {string} id @param {string[]} [targets] */
export function createTrialFixture(root, id, targets = []) {
  const repository = join(root, "source");
  readReviewGit(root, ["init", "--quiet", repository]);
  readReviewGit(repository, ["config", "user.name", "Example"]);
  readReviewGit(repository, ["config", "user.email", "example@example.com"]);
  const paths = [
    "apps/mlb/page/js/app.js",
    "apps/wnba/page/js/app.js",
    "shared/page/worker-store.js",
    "shared/worker/season-store.js",
  ];
  for (const path of paths) {
    mkdirSync(dirname(join(repository, path)), { recursive: true });
    writeFileSync(join(repository, path), "export const value = 1;\n");
  }
  readReviewGit(repository, ["add", "."]);
  readReviewGit(repository, ["commit", "--quiet", "-m", "Example parent"]);
  const base = readReviewGit(repository, ["rev-parse", "HEAD"]).trim();
  for (const path of paths) writeFileSync(join(repository, path), "export const value = 2;\n");
  readReviewGit(repository, ["commit", "--quiet", "-am", "Example historical change"]);
  const head = readReviewGit(repository, ["rev-parse", "HEAD"]).trim();
  writeFileSync(join(repository, paths[0]), "export const value = 3;\n");
  readReviewGit(repository, ["commit", "--quiet", "-am", "Example later fix"]);
  const fix = readReviewGit(repository, ["rev-parse", "HEAD"]).trim();
  const snapshot = { repository, entry: { id, head, targets } };
  const path = join(root, "snapshot.json");
  writeFileSync(path, JSON.stringify(snapshot));
  return { snapshot, base, fix, path, command: fileURLToPath(import.meta.url) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const snapshot = JSON.parse(readFileSync(process.env.TRIAL_TEST_FIXTURE, "utf8"));
    dispatchReviewTrial(process.argv.slice(2), process.env, snapshot);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
