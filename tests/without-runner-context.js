/**
 * The environment for a child process that runs outside the test runner. The runner marks its test
 * files with NODE_TEST_CONTEXT, which a nested process inherits: a nested runner then skips its
 * fixture files, and a plain process behaves as if the runner were running it.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeJS.ProcessEnv}
 */
export const withoutRunnerContext = (env = process.env) => ({
  ...env,
  NODE_TEST_CONTEXT: undefined,
});
