import test from "node:test";
import assert from "node:assert/strict";
import { setEmailKey } from "../worker/set-email-key.mjs";

const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct123" };
const API = "https://api.cloudflare.com/client/v4/accounts/acct123/workers";

function createFakeCloudflare({ secrets = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    let result = {};
    if (url.endsWith("/secrets") && init.method === "GET") result = secrets;
    return new Response(JSON.stringify({ success: true, result }));
  };
  return { fetchImpl, calls };
}

test("the accounts Worker gets a random email key, which is never printed", async () => {
  const keys = [];
  for (const channel of ["production", "beta"]) {
    const cloudflare = createFakeCloudflare();
    const printed = [];
    await setEmailKey({
      channel,
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      log: (line) => printed.push(line),
    });
    const put = cloudflare.calls.find((call) => call.init.method === "PUT");
    const worker = channel === "beta" ? "accounts-beta" : "accounts";
    assert.equal(put.url, `${API}/scripts/${worker}/secrets`);
    const { name, text, type } = JSON.parse(put.init.body);
    assert.deepEqual({ name, type }, { name: "EMAIL_KEY", type: "secret_text" });
    assert.match(text, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(printed.every((line) => !line.includes(text)));
    keys.push(text);
  }
  assert.notEqual(keys[0], keys[1]);
});

test("an email key already set stays, since every email kept is hashed under it", async () => {
  const cloudflare = createFakeCloudflare({
    secrets: [{ name: "EMAIL_KEY", type: "secret_text" }],
  });
  await assert.rejects(
    setEmailKey({ fetchImpl: cloudflare.fetchImpl, env: ENV, log: () => {} }),
    /already has an EMAIL_KEY/,
  );
  assert.ok(!cloudflare.calls.some((call) => call.init.method === "PUT"));
});
