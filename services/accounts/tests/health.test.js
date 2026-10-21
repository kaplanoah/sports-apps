import assert from "node:assert/strict";
import { test } from "node:test";
import { readServiceHealth } from "../worker/src/health.js";

const ENV = { EMAIL_KEY: "k3y", RP_ID: "example.test", VERSION: { tag: "abc1234" } };
const answering = async () => true;

test("the service is ok at its release once it has its secrets and its store answers", async () => {
  assert.deepEqual(await readServiceHealth({ env: ENV, isStoreAnswering: answering }), {
    ok: true,
    release: "abc1234",
  });
});

test("a service missing a secret is not ok, naming the secret and never a value", async () => {
  const health = await readServiceHealth({
    env: { ...ENV, RP_ID: undefined },
    isStoreAnswering: answering,
  });
  assert.deepEqual(health, { ok: false, release: "abc1234", problem: "no RP_ID secret" });
  assert.ok(!JSON.stringify(health).includes(ENV.EMAIL_KEY));
  assert.deepEqual(
    await readServiceHealth({ env: { VERSION: ENV.VERSION }, isStoreAnswering: answering }),
    { ok: false, release: "abc1234", problem: "no EMAIL_KEY or RP_ID secret" },
  );
});

test("a service whose store doesn't answer is not ok", async () => {
  const failing = async () => {
    throw new Error("The store threw");
  };
  assert.deepEqual(await readServiceHealth({ env: ENV, isStoreAnswering: failing }), {
    ok: false,
    release: "abc1234",
    problem: "its store doesn't answer",
  });
});
