import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { startAdmissionGateway } from "../worker/codex-rate-gateway.mjs";

class ResponseFixture extends EventEmitter {
  headersSent = false;
  destroyed = false;
  /** @type {ReadableStreamDefaultController<Uint8Array>} */
  controller;

  constructor(resolve, reject, onClose) {
    super();
    this.resolve = resolve;
    this.reject = reject;
    this.onClose = onClose;
    this.body = new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
    });
  }

  writeHead(status, headers) {
    this.headersSent = true;
    this.resolve(new Response(this.body, { status, headers }));
  }

  write(chunk) {
    this.controller.enqueue(Buffer.from(chunk));
    return true;
  }

  end(chunk) {
    if (chunk) this.write(chunk);
    this.controller.close();
    this.onClose();
    this.emit("close");
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const error = new Error("Fixture connection closed.");
    this.controller.error(error);
    if (!this.headersSent) this.reject(error);
    this.onClose();
    this.emit("close");
  }
}

export async function createRateHttpFixture(options) {
  const responses = new Set();
  let closed = false;
  let listener;
  let keepalive;
  const server = new EventEmitter();
  Object.assign(server, {
    listen(_port, address) {
      assertLoopback(address);
      keepalive = setInterval(() => {}, 1000);
      queueMicrotask(() => server.emit("listening"));
    },
    address() {
      return { address: "127.0.0.1", family: "IPv4", port: 12345 };
    },
    closeAllConnections() {
      for (const response of responses) response.destroy();
    },
    close(callback) {
      closed = true;
      clearInterval(keepalive);
      callback();
    },
  });
  const gateway = await startAdmissionGateway({
    ...options,
    createServer: (handler) => {
      listener = handler;
      return server;
    },
  });
  return {
    gateway,
    request(overrides = {}) {
      if (closed) return Promise.reject(new Error("Fixture listener closed."));
      return new Promise((resolve, reject) => {
        const request = Readable.from(
          overrides.body === undefined && overrides.method === "GET"
            ? []
            : [Buffer.from(overrides.body ?? JSON.stringify({ stream: true, input: "example" }))],
        );
        Object.assign(request, {
          method: overrides.method ?? "POST",
          url: overrides.url ?? "/v1/responses",
          headers: overrides.headers ?? {
            authorization: "Bearer fake-test",
            "content-type": "application/json",
          },
          socket: { remoteAddress: "127.0.0.1" },
        });
        const response = new ResponseFixture(resolve, reject, () => responses.delete(response));
        responses.add(response);
        void listener(request, response).catch(reject);
      });
    },
  };
}

function assertLoopback(address) {
  if (address !== "127.0.0.1") throw new Error("Gateway must bind IPv4 loopback.");
}
