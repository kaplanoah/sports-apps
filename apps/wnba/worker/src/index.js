import { DETAIL_READS } from "./detail-reads.js";
import { createDetailForwards } from "../../../../shared/worker/detail-reads.js";
import PAGE_FILES from "#page-files/wnba";
import { createAppWorker } from "../../../../shared/worker/app-worker.js";
import { SeasonStore, forwardToStore, readFeedFailures, readIdentityStatus } from "./store.js";

export default createAppWorker({
  name: "wnba",
  pageFiles: PAGE_FILES,
  forwardToStore,
  readFeedFailures,
  readIdentityStatus,
  reads: createDetailForwards(DETAIL_READS, forwardToStore),
});

export { SeasonStore };
