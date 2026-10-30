import PAGE_FILES from "#page-files/wnba";
import { createAppWorker } from "../../../../shared/worker/app-worker.js";
import { SeasonStore, forwardToStore, readFeedFailures } from "./store.js";

export default createAppWorker({
  name: "wnba",
  pageFiles: PAGE_FILES,
  forwardToStore,
  readFeedFailures,
  reads: {
    "/box-score": (url, env) => forwardToStore(new Request(url), env, "/box-score"),
    "/highlights": (url, env) => forwardToStore(new Request(url), env, "/highlights"),
    "/lead": (url, env) => forwardToStore(new Request(url), env, "/lead"),
    "/player": (url, env) => forwardToStore(new Request(url), env, "/player"),
    "/preview": (url, env) => forwardToStore(new Request(url), env, "/preview"),
    "/roster": (url, env) => forwardToStore(new Request(url), env, "/roster"),
  },
});

export { SeasonStore };
