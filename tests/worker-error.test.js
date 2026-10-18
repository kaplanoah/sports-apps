import test from "node:test";
import assert from "node:assert/strict";
import { readWorkerError } from "../shared/page/worker-error.js";

test("the Worker's error is the code and message it names", () => {
  const body = { error: { code: "push_failed", message: "The push service didn't answer." } };

  assert.deepEqual(readWorkerError(body, 502), {
    code: "push_failed",
    message: "The push service didn't answer.",
  });
});

test("an answer that names no error is told by its status, and by what answered", () => {
  assert.deepEqual(readWorkerError(null, 502), {
    code: "http_502",
    message: "The Worker answered 502",
  });
  assert.deepEqual(readWorkerError({ error: "down" }, 500, "The store"), {
    code: "http_500",
    message: "The store answered 500",
  });
});
