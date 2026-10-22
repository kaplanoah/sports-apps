// Node has no Workers runtime, so a built Worker's import of it reads the stand-in that
// #workers-runtime names instead.

const WORKERS_RUNTIME_STAND_IN = new URL("./workers-runtime.js", import.meta.url).href;

/** @param {string} script a built Worker */
export const replaceWorkersRuntime = (script) =>
  script.replaceAll('"cloudflare:workers"', JSON.stringify(WORKERS_RUNTIME_STAND_IN));

/** @param {string} script a built Worker */
export const importBundle = (script) =>
  import(`data:text/javascript,${encodeURIComponent(replaceWorkersRuntime(script))}`);
