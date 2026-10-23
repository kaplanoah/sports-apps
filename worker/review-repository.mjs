/** @param {NodeJS.ProcessEnv} [env] */
export function createReviewGitEnvironment(env = process.env) {
  if (env.REVIEW_BASE && !/^[0-9a-f]{40}$/.test(env.REVIEW_BASE))
    throw new Error("Review attributes require an immutable base revision.");
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
    ...(env.REVIEW_BASE ? { GIT_ATTR_SOURCE: env.REVIEW_BASE } : {}),
  };
}
