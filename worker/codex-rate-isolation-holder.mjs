import http from "node:http";
import { once } from "node:events";
import { startAdmissionGateway } from "./codex-rate-gateway.mjs";
import { createAdmissionController } from "./codex-rate-controller.mjs";

const responseText =
  'data: {"type":"response.output_text.delta","delta":"example"}\n\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":4,"output_tokens":2}}}\n\n';
const upstream = http.createServer((request, response) => {
  const correct = request.headers.authorization === "Bearer isolation-test-only";
  request.resume();
  response.writeHead(correct ? 200 : 403, { "content-type": "text/event-stream" });
  response.write(responseText.slice(0, 9));
  setImmediate(() => response.end(responseText.slice(9)));
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const address = upstream.address();
if (typeof address === "string" || !address) throw new Error("Loopback listener unavailable.");
const controller = createAdmissionController({ tokens: 10000, requests: 100, windowMs: 1000 });
const gateway = await startAdmissionGateway({
  budget: controller,
  estimate: () => 50,
  send: async (_url, options) => fetch(`http://127.0.0.1:${address.port}/v1/responses`, options),
});
let closed = false;
async function closeHolder() {
  if (closed) return;
  closed = true;
  await gateway.close();
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  process.disconnect?.();
}
process.on("message", (message) => {
  if (message === "close") void closeHolder();
});
process.on("disconnect", () => {
  void closeHolder();
});
process.on("SIGTERM", () => {
  void closeHolder();
});
process.send?.({ gateway: gateway.address.port, upstream: address.port });
