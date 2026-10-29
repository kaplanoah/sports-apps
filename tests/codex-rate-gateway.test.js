import test from "node:test";
import assert from "node:assert/strict";
import { OPENAI_RESPONSES_URL } from "../worker/codex-rate-gateway.mjs";
import { createAdmissionController } from "../worker/codex-rate-controller.mjs";

import { createRateHttpFixture } from "./codex-rate-http.js";
import { createRateClock } from "./codex-rate-clock.js";
import { createRequestEstimator } from "../worker/codex-rate-estimate.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function createBudget() {
  return {
    settled: [],
    deadlines: [],
    reservations: [],
    async reserve(value) {
      this.reservations.push(value);
      return this.reservations.length;
    },
    settle(id, observed) {
      this.settled.push({ id, observed });
    },
    defer(deadline) {
      this.deadlines.push(deadline);
    },
  };
}
/** @param {any} t @param {any} send @param {any} [options] */
async function createGateway(t, send, options = {}) {
  const budget = options.budget ?? createBudget();
  const fixture = await createRateHttpFixture({
    budget,
    estimate: () => ({ reservation: 30 }),
    send,
    ...options,
  });
  t.after(() => fixture.gateway.close());
  return { ...fixture, budget };
}

function createStream(chunks, failure) {
  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
        await tick();
      }
      if (failure) controller.error(failure);
      else controller.close();
    },
  });
}

test("request handler forwards split UTF-8 SSE bytes unchanged and counts usage once", async (t) => {
  const text =
    'data: {"type":"response.output_text.delta","delta":"caf\u00e9"}\r\n\r\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":11,"output_tokens":7,"input_tokens_details":{"cached_tokens":8},"output_tokens_details":{"reasoning_tokens":3}}}}\r\n\r\n';
  const bytes = Buffer.from(text);
  const split = bytes.indexOf(Buffer.from("\u00e9")) + 1;
  let calls = 0;
  const { request, budget } = await createGateway(t, async (url, options) => {
    calls++;
    assert.equal(url, OPENAI_RESPONSES_URL);
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers["accept-encoding"], "identity");
    assert.equal(options.headers.host, undefined);
    assert.equal(options.headers.authorization, "Bearer fake-test");
    assert.equal(JSON.parse(options.body.toString()).input, "example");
    return new Response(
      createStream([
        bytes.subarray(0, split),
        bytes.subarray(split, split + 8),
        bytes.subarray(split + 8),
      ]),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  const response = await request();
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(budget.settled, [{ id: 1, observed: 18 }]);
  assert.equal(JSON.stringify(budget).includes("fake-test"), false);
});

test("native session and sticky-routing headers survive both directions", async (t) => {
  let received;
  const { request } = await createGateway(t, async (_url, options) => {
    received = options.headers;
    return new Response("data: [DONE]\n\n", {
      headers: {
        "content-type": "text/event-stream",
        "x-codex-turn-state": "fake-next-state",
        "x-ratelimit-remaining-tokens": "100",
        connection: "x-private-hop",
        "x-private-hop": "fake-internal",
        authorization: "Bearer fake-response",
        "set-cookie": "fake=value",
      },
    });
  });
  const response = await request({
    headers: {
      authorization: "Bearer fake-test",
      "content-type": "application/json",
      "session-id": "fake-session",
      "x-codex-turn-state": "fake-state",
      "openai-beta": "fake-feature",
      connection: "x-remove-me",
      "x-remove-me": "fake-hop",
    },
  });
  assert.equal(received["session-id"], "fake-session");
  assert.equal(received["x-codex-turn-state"], "fake-state");
  assert.equal(received["openai-beta"], "fake-feature");
  assert.equal(received["x-remove-me"], undefined);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-codex-turn-state"), "fake-next-state");
  assert.equal(response.headers.get("x-ratelimit-remaining-tokens"), "100");
  assert.equal(response.headers.get("x-private-hop"), null);
  assert.equal(response.headers.get("authorization"), null);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("bad paths, methods, browser origins and missing authorization never reach upstream", async (t) => {
  let calls = 0;
  const { request, budget } = await createGateway(t, async () => {
    calls++;
    throw new Error("must not send");
  });
  for (const options of [
    { method: "GET", body: undefined },
    {
      headers: {
        origin: "https://example.invalid",
        authorization: "Bearer fake-test",
        "content-type": "application/json",
      },
    },
    { headers: { "content-type": "application/json" } },
  ]) {
    const response = await request(options);
    assert.equal(response.status, 403);
    await response.arrayBuffer();
  }
  const response = await request({
    url: "/v1/responses?upstream=https://example.invalid",
    method: "POST",
    headers: { authorization: "Bearer fake-test", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 403);
  await response.arrayBuffer();
  assert.equal(calls, 0);
  assert.deepEqual(budget.reservations, []);
});

test("loopback, encoding, JSON, streaming and byte limits reject before admission", async (t) => {
  for (const options of [
    { request: { remoteAddress: "192.0.2.1" } },
    {
      request: {
        headers: {
          authorization: "Bearer fake-test",
          "content-type": "application/json",
          "content-encoding": "gzip",
        },
      },
    },
    { request: { headers: { authorization: "Bearer fake-test", "content-type": "text/plain" } } },
    { request: { body: JSON.stringify({ stream: false, input: "example" }) } },
    { request: { body: "{" } },
    { request: {}, maxBodyBytes: 4 },
  ]) {
    let calls = 0;
    const fixture = await createGateway(
      t,
      async () => {
        calls++;
        return new Response("unexpected");
      },
      options.maxBodyBytes ? { maxBodyBytes: options.maxBodyBytes } : {},
    );
    const result = await fixture.request(options.request);
    assert.ok(result.status >= 400);
    await result.arrayBuffer();
    assert.equal(calls, 0);
    assert.deepEqual(fixture.budget.reservations, []);
  }
});

test("the real estimator supplies the numeric reservation used by the admission controller", async (t) => {
  const control = createAdmissionController({ tokens: 10000, requests: 10, windowMs: 60000 });
  const estimate = createRequestEstimator({
    encodingName: "o200k_base",
    outputReserveTokens: 100,
    overheadTokens: 10,
    headroom: 0.2,
  });
  let calls = 0;
  const fixture = await createGateway(
    t,
    async () => {
      calls++;
      return new Response(
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":4,"output_tokens":2}}}\n\n',
      );
    },
    { budget: control, estimate },
  );
  const result = await fixture.request();
  assert.equal(result.status, 200);
  await result.arrayBuffer();
  await tick();
  assert.equal(calls, 1);
  assert.equal(control.readSnapshot().local.events[0].observed, 6);
});

test("upstream redirects are rejected without following or exposing their location", async (t) => {
  let calls = 0;
  const { request, budget } = await createGateway(t, async (url) => {
    calls++;
    assert.equal(url, OPENAI_RESPONSES_URL);
    return new Response(null, {
      status: 302,
      headers: { location: "https://example.invalid/collect" },
    });
  });
  const response = await request();
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("location"), null);
  assert.equal((await response.text()).includes("collect"), false);
  assert.equal(calls, 1);
  assert.deepEqual(budget.settled, [{ id: 1, observed: null }]);
});

test("429 feedback sets one shared deadline and is returned once for native retry", async (t) => {
  let calls = 0;
  const { request, budget } = await createGateway(
    t,
    async () => {
      calls++;
      return new Response('{"error":{"code":"rate_limit_exceeded"}}', {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "2",
          "x-ratelimit-reset-tokens": "3s",
        },
      });
    },
    { now: () => 1000 },
  );
  const response = await request();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "3");
  assert.equal((await response.json()).error.code, "rate_limit_exceeded");
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(budget.deadlines, [4000]);
  assert.deepEqual(budget.settled, [{ id: 1, observed: null }]);
});

test("request handling waits for provider budget feedback before the next fake upstream send", async (t) => {
  const clock = createRateClock();
  const calls = [];
  const control = createAdmissionController(
    { tokens: 100, requests: 10, windowMs: 60000, feedbackHeadroom: 0 },
    clock,
  );
  const fixture = await createRateHttpFixture({
    budget: control,
    estimate: () => ({ reservation: 10 }),
    now: clock.now,
    send: async () => {
      calls.push(clock.now());
      return new Response(
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
        {
          headers: {
            "content-type": "text/event-stream",
            "x-ratelimit-remaining-tokens": "0",
            "x-ratelimit-reset-tokens": "2s",
          },
        },
      );
    },
  });
  t.after(() => fixture.gateway.close());
  for (let i = 0; i < 2; i++) {
    const pending = fixture.request({
      method: "POST",
      headers: { authorization: "Bearer fake-test", "content-type": "application/json" },
      body: JSON.stringify({ stream: true, input: "example" }),
    });
    if (i === 1) {
      await tick();
      await clock.advance(2000);
    }
    const response = await pending;
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  assert.deepEqual(calls, [0, 2000]);
  assert.deepEqual(
    control.readSnapshot().local.events.map((event) => event.observed),
    [2, 2],
  );
});

test("partial stream failure is never replayed and retains unavailable usage", async (t) => {
  let calls = 0;
  const { request, budget } = await createGateway(t, async () => {
    calls++;
    return new Response(
      createStream([Buffer.from("data: partial\n\n")], new Error("private upstream failure")),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  const response = await request();
  await assert.rejects(response.arrayBuffer());
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(budget.settled, [{ id: 1, observed: null }]);
});

test("oversized usage inspection cannot alter stream bytes or invent zero usage", async (t) => {
  const bytes = Buffer.from(
    "data: " +
      "x".repeat(200) +
      '\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":3}}}\n\n',
  );
  const { request, budget } = await createGateway(
    t,
    async () => new Response(createStream([bytes.subarray(0, 100), bytes.subarray(100)])),
    { maxFrameBytes: 32 },
  );
  const response = await request();
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  await tick();
  assert.deepEqual(budget.settled, [{ id: 1, observed: null }]);
});

test("gateway shutdown aborts an active upstream and closes its server", async (t) => {
  let observedSignal;
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const { request, gateway, budget } = await createGateway(t, async (_url, options) => {
    observedSignal = options.signal;
    started();
    return await new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  });
  const pending = assert.rejects(request());
  await ready;
  await gateway.close();
  await pending;
  await tick();
  assert.equal(observedSignal.aborted, true);
  assert.deepEqual(budget.settled, [{ id: 1, observed: null }]);
  await assert.rejects(request());
});

test("queue time does not consume the upstream timeout after admission", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let admit;
  let stream;
  const budget = createBudget();
  budget.reserve = () =>
    new Promise((resolve) => {
      admit = resolve;
    });
  const fixture = await createGateway(
    t,
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            stream = controller;
          },
        }),
      ),
    { budget, timeoutMs: 20 },
  );
  const pending = fixture.request();
  pending.catch(() => {});
  await tick();
  t.mock.timers.tick(10);
  admit(1);
  const response = await pending;
  const body = response.text();
  body.catch(() => {});
  t.mock.timers.tick(19);
  await tick();
  stream.enqueue(Buffer.from("data: example\n\n"));
  stream.close();
  assert.equal(await body, "data: example\n\n");
});

test("active streamed progress refreshes the inactivity timeout without replay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let stream;
  let calls = 0;
  const fixture = await createGateway(
    t,
    async () => {
      calls++;
      return new Response(
        new ReadableStream({
          start(controller) {
            stream = controller;
          },
        }),
      );
    },
    { timeoutMs: 20 },
  );
  const response = await fixture.request();
  const body = response.text();
  body.catch(() => {});
  t.mock.timers.tick(19);
  stream.enqueue(Buffer.from("data: first\n\n"));
  await tick();
  t.mock.timers.tick(19);
  stream.enqueue(Buffer.from("data: second\n\n"));
  stream.close();
  assert.equal(await body, "data: first\n\ndata: second\n\n");
  assert.equal(calls, 1);
});

test("timeout aborts a hung upstream without retry and keeps usage unavailable", async (t) => {
  let calls = 0;
  const { request, budget } = await createGateway(
    t,
    async (_url, options) => {
      calls++;
      return await new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    },
    { timeoutMs: 20 },
  );
  await assert.rejects(request());
  await tick();
  assert.equal(calls, 1);
  assert.deepEqual(budget.settled, [{ id: 1, observed: null }]);
});
