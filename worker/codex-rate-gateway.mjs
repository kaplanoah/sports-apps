import http from "node:http";
import { once } from "node:events";
import { parseRetryAfter, parseReset } from "./codex-rate-budget.mjs";

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

/** @param {any} source @param {boolean} [request] */
function filterProxyHeaders(source, request = false) {
  const headers = new Headers(source);
  const removed = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
  ]);
  for (const value of (headers.get("connection") ?? "").split(","))
    removed.add(value.trim().toLowerCase());
  if (!request)
    for (const name of ["content-encoding", "authorization", "cookie", "set-cookie"])
      removed.add(name);
  const result = {};
  for (const [name, value] of headers) if (!removed.has(name)) result[name] = value;
  if (request) result["accept-encoding"] = "identity";
  return result;
}

function requireSafeAmount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function readStreamEvent(frame) {
  if (!frame.startsWith("data:")) return null;
  let event;
  try {
    event = JSON.parse(frame.slice(5).trim());
  } catch {
    return null;
  }
  return event;
}

function readUsage(event) {
  if (event?.type !== "response.completed") return null;
  const usage = event.response?.usage;
  if (!requireSafeAmount(usage?.input_tokens) || !requireSafeAmount(usage?.output_tokens))
    return null;
  const total = usage.input_tokens + usage.output_tokens;
  return requireSafeAmount(total) ? total : null;
}

function createUsageReader(maxFrameBytes, observeError) {
  const decoder = new TextDecoder();
  let buffered = "";
  let observed = null;
  let disabled = false;
  function inspect(frame) {
    const event = readStreamEvent(frame);
    if (event?.type === "response.failed") observeError(event.response?.error);
    else if (event?.type === "error") observeError(event.error ?? event);
    return readUsage(event);
  }
  return {
    append(chunk) {
      if (disabled) return;
      buffered += decoder.decode(chunk, { stream: true });
      for (;;) {
        const split = buffered.indexOf("\n");
        if (split < 0) break;
        observed = inspect(buffered.slice(0, split).replace(/\r$/, "")) ?? observed;
        buffered = buffered.slice(split + 1);
      }
      if (Buffer.byteLength(buffered) > maxFrameBytes) {
        buffered = "";
        disabled = true;
        observed = null;
      }
    },
    complete() {
      if (disabled) return null;
      buffered += decoder.decode();
      return inspect(buffered.replace(/\r$/, "")) ?? observed;
    },
  };
}

/** @param {import("node:http").IncomingMessage} request @param {number} maxBodyBytes */
async function readRequestBody(request, maxBodyBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("Request body limit exceeded.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** @param {import("node:http").ServerResponse} response @param {number} status */
function rejectRequest(response, status) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end('{"error":{"message":"Request rejected by local admission control."}}');
}

/** @param {any} options */
export function createAdmissionRequestHandler({
  budget,
  estimate,
  send,
  now = Date.now,
  maxBodyBytes = 8 * 1024 * 1024,
  maxFrameBytes = 4 * 1024 * 1024,
  fallbackCooldownMs = 1000,
  timeoutMs = 300000,
}) {
  const active = new Set();
  const pending = new Set();
  let failed = false;
  async function serveRequest(request, response) {
    if (
      request.method !== "POST" ||
      request.url !== "/v1/responses" ||
      request.headers.origin ||
      request.socket.remoteAddress !== "127.0.0.1" ||
      request.headers["content-encoding"] ||
      !/^Bearer [^\r\n]+$/.test(request.headers.authorization ?? "") ||
      request.headers["content-type"] !== "application/json"
    ) {
      rejectRequest(response, 403);
      return;
    }
    const controller = new AbortController();
    active.add(controller);
    let ticket;
    let observed = null;
    let completed = false;
    const abort = () => {
      if (!completed) controller.abort();
    };
    let timeout;
    function restartInactivityTimeout() {
      clearTimeout(timeout);
      timeout = setTimeout(abort, timeoutMs);
      timeout.unref();
    }
    restartInactivityTimeout();
    controller.signal.addEventListener(
      "abort",
      () => {
        if (!completed) {
          request.destroy();
          response.destroy();
        }
      },
      { once: true },
    );
    response.on("close", abort);
    try {
      const body = await readRequestBody(request, maxBodyBytes);
      const payload = JSON.parse(body.toString("utf8"));
      if (payload.stream !== true) throw new Error("Streaming response required.");
      ticket = await budget.reserve(estimate(payload).reservation, controller.signal);
      if (controller.signal.aborted) throw new Error("Client disconnected.");
      restartInactivityTimeout();
      const upstream = await send(OPENAI_RESPONSES_URL, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: filterProxyHeaders(request.headers, true),
        body,
      });
      if (upstream.status >= 300 && upstream.status < 400)
        throw new Error("Upstream redirect rejected.");
      budget.observeHeaders?.(upstream.headers);
      const headers = filterProxyHeaders(upstream.headers);
      const retryAfter = parseRetryAfter(upstream.headers, now());
      if (upstream.status === 429 || (upstream.status >= 500 && retryAfter !== null)) {
        const deadline = Math.max(
          now() + fallbackCooldownMs,
          retryAfter ?? 0,
          parseReset(upstream.headers.get("x-ratelimit-reset-tokens"), now()) ?? 0,
          parseReset(upstream.headers.get("x-ratelimit-reset-requests"), now()) ?? 0,
        );
        budget.defer(deadline);
        headers["retry-after"] = String(Math.ceil((deadline - now()) / 1000));
      } else {
        const advice = upstream.headers.get("retry-after");
        if (advice !== null) headers["retry-after"] = advice;
      }
      response.writeHead(upstream.status, headers);
      const usage = createUsageReader(maxFrameBytes, (error) => {
        if (!["rate_limit_exceeded", "slow_down"].includes(error?.code)) return;
        const match = /try again in\s+(\S+(?:\s+seconds?)?)/i.exec(error.message ?? "");
        const duration = match?.[1].replace(/[.,;!?]+$/, "").replace(/\s*seconds?$/i, "s");
        const advised = duration ? parseReset(duration, now()) : null;
        budget.defer(Math.max(now() + fallbackCooldownMs, retryAfter ?? 0, advised ?? 0));
      });
      for await (const chunk of upstream.body ?? []) {
        restartInactivityTimeout();
        usage.append(chunk);
        if (!response.write(chunk)) await once(response, "drain", { signal: controller.signal });
      }
      observed = upstream.ok ? usage.complete() : null;
      completed = true;
      response.end();
    } catch {
      if (response.headersSent) response.destroy();
      else if (!response.destroyed) {
        completed = true;
        rejectRequest(response, 502);
      }
    } finally {
      clearTimeout(timeout);
      controller.abort();
      active.delete(controller);
      if (ticket !== undefined) budget.settle(ticket, observed);
    }
  }
  return {
    serveRequest(request, response) {
      const task = serveRequest(request, response);
      pending.add(task);
      task.then(
        () => pending.delete(task),
        () => {
          failed = true;
          pending.delete(task);
          if (!response.writableEnded) response.destroy();
        },
      );
      return task;
    },
    async abortRequests() {
      for (const controller of active) controller.abort();
      await Promise.allSettled([...pending]);
      if (failed) throw new Error("A native admission request could not finalize.");
    },
  };
}

/** @param {any} options */
export async function startAdmissionGateway(options) {
  const requests = createAdmissionRequestHandler(options);
  const server = (options.createServer ?? http.createServer)(requests.serveRequest);
  server.listen(options.port ?? 0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback address unavailable.");
  let closed = false;
  return {
    address,
    async close() {
      if (closed) return;
      closed = true;
      const drained = requests.abortRequests().then(
        () => null,
        (error) => error,
      );
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve(undefined))),
      );
      const failure = await drained;
      if (failure) throw failure;
    },
  };
}
