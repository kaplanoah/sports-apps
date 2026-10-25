import test from "node:test";
import assert from "node:assert/strict";
import { createVisitCounter } from "../shared/worker/visits.js";
import { createDurableObjectContext } from "./durable-object-context.js";

const CUSTOM = "app.example";
const LEGACY = "app.example-subdomain.workers.dev";
const NOW = Date.parse("2026-10-25T16:00:00Z");

function createCounter(now = () => NOW) {
  const context = createDurableObjectContext();
  return { ...context, counter: createVisitCounter({ storage: context.ctx.storage, now }) };
}

/** @param {string} host @param {string} [method] */
const request = (host = CUSTOM, method = "POST") =>
  new Request(`https://${host}/visits`, { method });

test("simultaneous visits persist only daily totals by hostname, without identifying data", async () => {
  const { counter, stored } = createCounter();
  const responses = await Promise.all(Array.from({ length: 20 }, () => counter.serve(request())));
  assert.ok(responses.every((response) => response.status === 204));
  await counter.serve(
    new Request(`https://${LEGACY}/visits?private=ignored`, {
      method: "POST",
      headers: { cookie: "secret=private", "cf-connecting-ip": "203.0.113.7" },
      body: "sensitive data is never read or stored",
    }),
  );
  assert.deepEqual(
    [...stored],
    [["visits:daily", { "2026-10-25": { [CUSTOM]: 20, [LEGACY]: 1 } }]],
  );
  const response = await counter.serve(request(CUSTOM, "GET"));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), {
    timeZone: "America/New_York",
    retentionDays: 35,
    days: { "2026-10-25": { [CUSTOM]: 20, [LEGACY]: 1 } },
  });
});

test("visits use Eastern calendar days across midnight and the daylight-saving change", async () => {
  let now = Date.parse("2026-11-01T03:59:59Z");
  const { counter } = createCounter(() => now);
  await counter.serve(request());
  now = Date.parse("2026-11-01T04:00:00Z");
  await counter.serve(request());
  now = Date.parse("2026-11-01T06:30:00Z");
  await counter.serve(request());
  assert.deepEqual((await (await counter.serve(request(CUSTOM, "GET"))).json()).days, {
    "2026-10-31": { [CUSTOM]: 1 },
    "2026-11-01": { [CUSTOM]: 2 },
  });
});

test("reads and scheduled cleanup remove totals outside the last thirty-five calendar days", async () => {
  const { counter, stored } = createCounter();
  stored.set("visits:daily", {
    "2026-09-20": { [CUSTOM]: 4 },
    "2026-09-21": { [CUSTOM]: 5 },
    "2026-10-25": { [CUSTOM]: 6 },
  });
  await counter.prune();
  assert.deepEqual(stored.get("visits:daily"), {
    "2026-09-21": { [CUSTOM]: 5 },
    "2026-10-25": { [CUSTOM]: 6 },
  });
  assert.deepEqual(
    (await (await counter.serve(request(CUSTOM, "GET"))).json()).days,
    stored.get("visits:daily"),
  );
});

test("a storage failure does not poison later visits and other HTTP methods cannot count", async () => {
  const { counter, ctx } = createCounter();
  const put = ctx.storage.put;
  ctx.storage.put = async () => {
    throw new Error("storage unavailable");
  };
  await assert.rejects(counter.serve(request()), /storage unavailable/);
  ctx.storage.put = put;
  await counter.serve(request());
  const denied = await counter.serve(request(CUSTOM, "DELETE"));
  assert.equal(denied.status, 405);
  assert.deepEqual((await (await counter.serve(request(CUSTOM, "GET"))).json()).days, {
    "2026-10-25": { [CUSTOM]: 1 },
  });
});
