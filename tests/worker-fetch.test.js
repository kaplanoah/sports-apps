import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchFromWorker } from "../shared/page/worker-fetch.js";

const PAGE = "https://wnba-app.example/k3y/";
const RULES = { reuseMs: 1000, timeoutMs: 5000, isExpected: (body) => body.id === "1" };

// Stand-ins for the browser: the page's address, and a Worker that answers each read in turn.
function startWorker(...answers) {
  const reads = [];
  globalThis.location = /** @type {any} */ ({ href: PAGE });
  globalThis.fetch = /** @type {any} */ (
    async (url, init) => {
      reads.push({ url: String(url), init });
      const { body, status = 200 } = answers.shift();
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }
  );
  return reads;
}

test("a read asks the Worker beside the page, unstored and with a time limit", async () => {
  const reads = startWorker({ body: { id: "1" } });

  assert.deepEqual(await fetchFromWorker("box-score?id=1", RULES), { id: "1" });
  assert.equal(reads[0].url, `${PAGE}box-score?id=1`);
  assert.equal(reads[0].init.cache, "no-store");
  assert.ok(reads[0].init.signal instanceof AbortSignal);
});

test("a read within the reuse time shares the first, and one after it asks again", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 0 });
  const reads = startWorker({ body: { id: "1" } }, { body: { id: "1", later: true } });

  const first = fetchFromWorker("reused", RULES);
  context.mock.timers.tick(999);
  assert.equal(fetchFromWorker("reused", RULES), first);
  assert.equal(reads.length, 1);
  context.mock.timers.tick(1);
  assert.deepEqual(await fetchFromWorker("reused", RULES), { id: "1", later: true });
  assert.equal(reads.length, 2);
});

test("each path keeps its own read, and each caller its own reuse time", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 0 });
  const reads = startWorker({ body: { id: "1" } }, { body: { id: "1" } }, { body: { id: "1" } });

  await fetchFromWorker("one", RULES);
  await fetchFromWorker("two", RULES);
  context.mock.timers.tick(500);
  await fetchFromWorker("one", RULES);
  await fetchFromWorker("one", { ...RULES, reuseMs: 100 });
  assert.deepEqual(
    reads.map((read) => read.url),
    [`${PAGE}one`, `${PAGE}two`, `${PAGE}one`],
  );
});

test("a failed read is forgotten, so the next one asks again", async () => {
  const failure = {
    body: { error: { code: "upstream_error", message: "Couldn't read the WNBA" } },
    status: 502,
  };
  const reads = startWorker(failure, { body: { id: "1" } });

  await assert.rejects(fetchFromWorker("failing", RULES), {
    message: "Couldn't read the WNBA",
    status: 502,
  });
  assert.deepEqual(await fetchFromWorker("failing", RULES), { id: "1" });
  assert.equal(reads.length, 2);
});

test("a route's error says what went wrong in its message, as the store's does", async () => {
  startWorker({
    body: { error: { code: "upstream_error", message: "Couldn't read MLB: down" } },
    status: 502,
  });

  await assert.rejects(fetchFromWorker("down", RULES), {
    message: "Couldn't read MLB: down",
    status: 502,
  });
});

test("an error without a message of its own names the Worker's status", async () => {
  startWorker({ body: "Not found", status: 404 });

  await assert.rejects(fetchFromWorker("missing", RULES), {
    message: "The Worker answered 404",
    status: 404,
  });
});

test("an answer that isn't JSON, or isn't the one asked for, is unexpected", async () => {
  startWorker({ body: "<html>" }, { body: { id: "2" } });

  await assert.rejects(fetchFromWorker("garbled", RULES), {
    message: "unexpected answer",
    status: 200,
  });
  await assert.rejects(fetchFromWorker("other", RULES), {
    message: "unexpected answer",
    status: 200,
  });
});
