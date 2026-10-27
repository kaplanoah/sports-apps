import test from "node:test";
import assert from "node:assert/strict";
import { fetchMlbJson } from "../worker/src/mlb.js";

const answerWith = (/** @type {string} */ body) => async () => new Response(body);

test("MLB's answer is the JSON it sent", async () => {
  const schedule = { dates: [] };
  assert.deepEqual(
    await fetchMlbJson(answerWith(JSON.stringify(schedule)), "/api/v1/schedule?sportId=1", 60),
    schedule,
  );
});

test("an answer from MLB that isn't JSON says what came back, for the path without its query", async () => {
  const page = "<html><head><title>Service Unavailable</title></head></html>";
  await assert.rejects(fetchMlbJson(answerWith(page), "/api/v1/schedule?sportId=1", 60), {
    message:
      'MLB Stats API answered /api/v1/schedule with a web page titled "Service Unavailable" rather than data',
  });
});
