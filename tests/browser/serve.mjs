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

/** @param {import("node:http").IncomingMessage} request */
async function createWorkerRequest(request) {
  const headers = new Headers();
  for (let index = 0; index < request.rawHeaders.length; index += 2)
    headers.append(request.rawHeaders[index], request.rawHeaders[index + 1]);
  const url = new URL(`/test-key${request.url}`, `http://${request.headers.host}`);
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : Buffer.concat(chunks);
  return new Request(url, { method: request.method, headers, body });
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 */
async function servePageFile(request, response) {
  try {
    const forwarded = await createWorkerRequest(request);
    const answer = await worker.fetch(forwarded, { APP_KEY: "test-key" });
    const body = Buffer.from(await answer.arrayBuffer());
    response.writeHead(answer.status, Object.fromEntries(answer.headers));
    response.end(body);
  } catch {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end("The test Worker could not answer.");
  }
}

createServer(servePageFile).listen(Number(port), "127.0.0.1");
