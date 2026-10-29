import { createServer } from "node:http";
import { join } from "node:path";
import { createAppWorker } from "../../shared/worker/app-worker.js";
import { readPageFiles } from "../../worker/page-files.mjs";

// Serves one app's page, named from the repo's root, as its Worker bundles it, at the server's root.
const [port, pageFolder] = process.argv.slice(2);
if (!port || !pageFolder) {
  console.error("usage: node tests/browser/serve.mjs <port> apps/<app>/page");
  process.exit(1);
}
const worker = createAppWorker({
  name: "test",
  pageFiles: readPageFiles(join(import.meta.dirname, "..", "..", pageFolder)),
  forwardToStore: () => new Response(null, { status: 404 }),
  readFeedFailures: async () => ({}),
});

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function servePageFile(request, response) {
  const url = new URL(`/test-key${request.url}`, `http://${request.headers.host}`);
  const answer = await worker.fetch(new Request(url), { APP_KEY: "test-key" });
  response.writeHead(answer.status, Object.fromEntries(answer.headers));
  response.end(Buffer.from(await answer.arrayBuffer()));
}

createServer(servePageFile).listen(Number(port), "127.0.0.1");
