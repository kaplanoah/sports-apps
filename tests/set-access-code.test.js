import test from "node:test";
import assert from "node:assert/strict";
import { setAccessCode } from "../worker/set-access-code.mjs";
import { createFakeCloudflare } from "./fake-cloudflare.js";

const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct123" };
const SECRETS_URL =
  "https://api.cloudflare.com/client/v4/accounts/acct123/workers/scripts/wnba-app/secrets";

const changeCode = (cloudflare, options) =>
  setAccessCode({
    app: "wnba",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    log: () => {},
    ...options,
  });

test("the code is stored as the Worker's ACCESS_CODE secret, after a new key to sign with", async () => {
  const cloudflare = createFakeCloudflare();
  await changeCode(cloudflare, { code: "fast break", makeSigningKey: () => "n3wsigningkey" });
  const puts = cloudflare.calls.filter((call) => call.init.method === "PUT");
  assert.ok(puts.every((put) => put.url === SECRETS_URL));
  assert.deepEqual(
    puts.map((put) => JSON.parse(put.init.body)),
    [
      { name: "ACCESS_SIGNING_KEY", text: "n3wsigningkey", type: "secret_text" },
      { name: "ACCESS_CODE", text: "fast break", type: "secret_text" },
    ],
  );
});

test("a code too short to guard the page, or none, is refused before Cloudflare hears of it", async () => {
  for (const code of [undefined, "", "a-b c"]) {
    const cloudflare = createFakeCloudflare();
    await assert.rejects(changeCode(cloudflare, { code }), /at least 4 letters or digits/);
    assert.equal(cloudflare.calls.length, 0);
  }
});

test("--remove deletes the code and its signing key, and does nothing when there's none", async () => {
  const set = createFakeCloudflare({
    secrets: [
      { name: "ACCESS_CODE", type: "secret_text" },
      { name: "ACCESS_SIGNING_KEY", type: "secret_text" },
    ],
  });
  await changeCode(set, { isRemoving: true });
  const removals = set.calls.filter((call) => call.init.method === "DELETE");
  assert.deepEqual(
    removals.map((call) => call.url),
    [`${SECRETS_URL}/ACCESS_CODE`, `${SECRETS_URL}/ACCESS_SIGNING_KEY`],
  );

  const unset = createFakeCloudflare();
  const printed = [];
  await changeCode(unset, { isRemoving: true, log: (line) => printed.push(line) });
  assert.ok(!unset.calls.some((call) => call.init.method === "DELETE"));
  assert.ok(printed.includes("The page asks for no code."));
});

test("the beta channel's code goes to the beta Worker", async () => {
  const cloudflare = createFakeCloudflare();
  await changeCode(cloudflare, { channel: "beta", code: "fast break" });
  const puts = cloudflare.calls.filter((call) => call.init.method === "PUT");
  assert.equal(puts.length, 2);
  assert.ok(puts.every((put) => put.url === SECRETS_URL.replace("/wnba-app/", "/wnba-app-beta/")));
});
