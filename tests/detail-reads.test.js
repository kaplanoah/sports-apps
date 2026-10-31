import { createDeferred } from "./deferred.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createDetailReads,
  DETAIL_REUSE_MS,
  DETAIL_RETENTION_MS,
  MAX_DETAIL_ANSWERS,
} from "../shared/worker/detail-reads.js";
import { createDocs, createJobStorage } from "./job-context.js";

function createReads() {
  const storage = createJobStorage();
  const docs = createDocs();
  let now = 0;
  let fails = false;
  let requests = 0;
  const definitions = {
    "/detail": {
      parameters: ["id"],
      read: async (_services, url) => {
        requests += 1;
        return fails
          ? new Response(null, { status: 502 })
          : Response.json({ id: url.searchParams.get("id") });
      },
    },
  };
  const create = () =>
    createDetailReads(definitions, { docs, storage, now: () => now, services: {} });
  let read = create();
  return {
    storage,
    countRequests: () => requests,
    advance: (ms) => {
      now += ms;
    },
    fail: () => {
      fails = true;
    },
    restart: () => {
      read = create();
    },
    read: (query) => read(new URL(`https://store/detail?${query}`)),
  };
}

test("extra query parameters share one stored detail answer across concurrent reads and restarts", async () => {
  const reads = createReads();
  const responses = await Promise.all(["id=1&x=1", "x=2&id=1", "id=1"].map(reads.read));
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(reads.countRequests(), 1);
  assert.equal(reads.storage.stored.size, 1);
  reads.fail();
  reads.restart();
  assert.deepEqual(await (await reads.read("id=1&x=3")).json(), { id: "1" });
  assert.equal(reads.countRequests(), 2);
});

test("temporary detail answers are bounded and expire without extending their lifetime on failures", async () => {
  const reads = createReads();
  for (let id = 0; id <= MAX_DETAIL_ANSWERS; id += 1) {
    await reads.read(`id=${id}`);
    reads.advance(DETAIL_REUSE_MS + 1);
  }
  assert.equal(reads.storage.stored.size, MAX_DETAIL_ANSWERS);
  reads.fail();
  reads.restart();
  assert.equal((await reads.read("id=0")).status, 502);
  assert.equal((await reads.read(`id=${MAX_DETAIL_ANSWERS}`)).status, 200);
  reads.advance(DETAIL_RETENTION_MS);
  reads.restart();
  assert.equal((await reads.read(`id=${MAX_DETAIL_ANSWERS}`)).status, 502);
});

for (const field of [null, "boxScore"]) {
  test(`a late ${field ?? "whole-document"} read preserves a newer canonical final`, async () => {
    const docs = createDocs();
    const storage = createJobStorage();
    const { promise: started, resolve: announce } = createDeferred();
    const { promise: held, resolve: release } = createDeferred();
    const read = createDetailReads(
      {
        "/detail": {
          parameters: ["id"],
          nameKey: () => "games/1",
          ...(field && { field }),
          read: async () => {
            announce();
            await held;
            return Response.json({ id: "1", state: "final", source: "espn" });
          },
        },
      },
      { docs, storage, now: () => 0, services: {} },
    );
    const pending = read(new URL("https://store/detail?id=1"));
    await started;
    const final = { id: "1", state: "final", score: [99, 98] };
    const stored = field ? { [field]: final, lead: { isOver: true } } : final;
    await docs.write("games/1", stored);
    release();
    assert.deepEqual(await (await pending).json(), final);
    assert.deepEqual(await docs.read("games/1"), stored);
  });
}
