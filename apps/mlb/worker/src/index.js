import PAGE_FILES from "#page-files/mlb";
import { createAppWorker } from "../../../../shared/worker/app-worker.js";
import { SeasonStore, forwardToStore, readFeedFailures } from "./store.js";

export default createAppWorker({
  name: "mlb",
  pageFiles: PAGE_FILES,
  forwardToStore,
  readFeedFailures,
  reads: {
    "/box-score": (url, env) => forwardToStore(new Request(url), env, "/box-score"),
    "/highlights": (url, env) => forwardToStore(new Request(url), env, "/highlights"),
    "/pitcher": (url, env) => forwardToStore(new Request(url), env, "/pitcher"),
    "/rotation": (url, env) => forwardToStore(new Request(url), env, "/rotation"),
  },
});

export { SeasonStore };
