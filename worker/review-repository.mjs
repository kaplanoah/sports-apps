// Runs Git against reviewed data without inheriting credentials or executable Git configuration.
import { execFileSync } from "node:child_process";
import { isGitObjectId } from "./git-object.mjs";

/** @param {NodeJS.ProcessEnv} [env] */
export function createReviewGitEnvironment(env = process.env) {
  const needsTrustedAttributes = env.REVIEW_BASE !== undefined || env.REVIEW_TRUSTED !== undefined;
  if (needsTrustedAttributes && !isGitObjectId(env.REVIEW_TRUSTED))
    throw new Error("Review attributes require an immutable trusted revision.");
  return {
    PATH: env.PATH,
    LANG: "C.UTF-8",
    HTTP_PROXY: env.HTTP_PROXY,
    HTTPS_PROXY: env.HTTPS_PROXY,
    ALL_PROXY: env.ALL_PROXY,
    NO_PROXY: env.NO_PROXY,
    http_proxy: env.http_proxy,
    https_proxy: env.https_proxy,
    all_proxy: env.all_proxy,
    no_proxy: env.no_proxy,
    SSL_CERT_FILE: env.SSL_CERT_FILE,
    SSL_CERT_DIR: env.SSL_CERT_DIR,
    GIT_SSL_CAINFO: env.GIT_SSL_CAINFO,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ATTR_NOSYSTEM: "1",
    ...(env.REVIEW_TRUSTED ? { GIT_ATTR_SOURCE: env.REVIEW_TRUSTED } : {}),
  };
}

/** @overload @param {string} cwd @param {string[]} args @returns {string} */
/** @overload @param {string} cwd @param {string[]} args @param {"buffer"} encoding @returns {Buffer} */
/** @param {string} cwd @param {string[]} args @param {"utf8" | "buffer"} [encoding] @returns {string | Buffer} */
export function readReviewGit(cwd, args, encoding = "utf8") {
  const command = ["-c", "core.hooksPath=/dev/null", "-c", "core.quotePath=false", ...args];
  const options = { cwd, env: createReviewGitEnvironment(), maxBuffer: 64 * 1024 * 1024 };
  if (encoding === "buffer") return execFileSync("git", command, options);
  return execFileSync("git", command, { ...options, encoding: "utf8" });
}
