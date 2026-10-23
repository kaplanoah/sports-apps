// The only command CI's reviewer may run: git grep, git log, or git show with an allowlist of
// options, and revisions and paths inside the repo. The reviewer reads text anyone may have written,
// so this allows what a review needs rather than refusing what's known to be harmful, since a
// shell's quotes and backslashes have spelled each refused option past a rule that matched text.
// By the time the arguments arrive here the shell has taken those out, and git runs with no shell.
// Usage: node worker/review-git.mjs log|show [options] [revisions] [-- paths]
// History options: -p --stat --name-only --name-status --follow --diff-merges=first-parent
// --no-patch --oneline -n <number> -n<number> -<number> --format=<format> --pretty=<format>
// -L<start>,<end>:<path> -L:<function>:<path>, or -L followed by the range and path.
// Usage: node worker/review-git.mjs grep [options] -e <pattern> [-e <pattern> ...] [-- paths]
// Search options: -n -l -i -w -F -E.
import { execFileSync } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const COMMANDS = new Set(["log", "show"]);
const SEARCH_FLAGS = new Set(["-n", "-l", "-i", "-w", "-F", "-E"]);
const FLAGS = new Set([
  "-p",
  "--stat",
  "--name-only",
  "--name-status",
  "--follow",
  "--diff-merges=first-parent",
  "--no-patch",
  "--oneline",
]);
const VALUED_FLAGS = ["--format=", "--pretty="];
const COUNT = /^-n?\d+$/;
const DIGITS = /^\d+$/;
// A line range, "start,end" or "start,+count", or a function's name, before the file's path.
const LINE_RANGE = /^(?:\d+(?:,[+-]?\d+)?|:[^:]+):(.+)$/;

/**
 * Whether a path, read from the repo's root as git reads it there, stays inside the repo.
 * @param {string} root
 * @param {string} path
 */
const isInsideRepo = (root, path) => {
  const fromRoot = relative(root, resolve(root, path));
  return fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
};

/**
 * Why a revision, or a path given where git looks for one, is refused, or null when it's allowed.
 * `<rev>:<path>` reads the path from the revision's tree.
 * @param {string} root
 * @param {string} argument
 */
function findRevisionRefusal(root, argument) {
  const colon = argument.indexOf(":");
  const path = colon === -1 ? argument : argument.slice(colon + 1);
  return isInsideRepo(root, path) ? null : "a revision reaches outside the repo";
}

/**
 * Why a line range is refused, or null when its path is inside the repo.
 * @param {string} root
 * @param {string | undefined} range
 */
function findRangeRefusal(root, range) {
  const path = range?.match(LINE_RANGE)?.[1];
  if (path === undefined) return "-L takes start,end:<path> or :<function>:<path>";
  return isInsideRepo(root, path) ? null : "an -L path reaches outside the repo";
}

/**
 * Why the paths after `--` are refused, or null when each is inside the repo.
 * @param {string} root
 * @param {string[]} paths
 */
function findPathRefusal(root, paths) {
  return paths.every((path) => isInsideRepo(root, path))
    ? null
    : "a path after -- is outside the repo";
}

/**
 * Why a checkout search is refused, or null when it only searches tracked files inside the repo.
 * @param {string[]} args
 * @param {string} root
 */
function findSearchRefusal(args, root) {
  let hasPattern = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      if (!hasPattern) return "grep takes at least one -e pattern";
      return findPathRefusal(root, args.slice(index + 1));
    }
    if (SEARCH_FLAGS.has(argument)) continue;
    if (argument === "-e") {
      index += 1;
      if (args[index] === undefined) return "-e takes a pattern";
      hasPattern = true;
      continue;
    }
    return "a search argument isn't one the review uses";
  }
  return hasPattern ? null : "grep takes at least one -e pattern";
}

/**
 * Why the arguments are refused, or null when git may run them.
 * @param {string[]} args the subcommand and what follows it, as the shell passed them
 * @param {string} root the repo's root
 */
export function findRefusal(args, root) {
  const [command, ...rest] = args;
  if (command === "grep") return findSearchRefusal(rest, root);
  if (!COMMANDS.has(command)) return "the first argument must be grep, log, or show";
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--") return findPathRefusal(root, rest.slice(index + 1));
    if (FLAGS.has(argument) || COUNT.test(argument)) continue;
    if (VALUED_FLAGS.some((prefix) => argument.startsWith(prefix))) continue;
    if (argument === "-n") {
      index += 1;
      if (!DIGITS.test(rest[index] ?? "")) return "-n takes a number";
      continue;
    }
    if (argument.startsWith("-L")) {
      const range = argument === "-L" ? rest[(index += 1)] : argument.slice(2);
      const refusal = findRangeRefusal(root, range);
      if (refusal) return refusal;
      continue;
    }
    if (argument.startsWith("-")) return "an option isn't one the review uses";
    const refusal = findRevisionRefusal(root, argument);
    if (refusal) return refusal;
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const args = process.argv.slice(2);
  const refusal = findRefusal(args, root);
  if (refusal) {
    console.error(`review-git: refused: ${refusal}.`);
    process.exit(2);
  }
  try {
    execFileSync("git", args, { cwd: root, stdio: "inherit" });
  } catch (error) {
    process.exitCode = /** @type {{ status?: number }} */ (error).status ?? 1;
  }
}
