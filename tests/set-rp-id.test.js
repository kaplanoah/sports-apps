import test from "node:test";
import assert from "node:assert/strict";
import { setRelyingPartyId } from "../worker/set-rp-id.mjs";

const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct123" };
const API = "https://api.cloudflare.com/client/v4/accounts/acct123/workers";
const SITE = "example.test";

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

test("the accounts Worker on each channel gets the site as its RP_ID, which is never printed", async () => {
  for (const channel of ["production", "beta"]) {
    const cloudflare = createFakeCloudflare();
    const printed = [];
    await setRelyingPartyId({
      relyingPartyId: SITE,
      channel,
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      log: (line) => printed.push(line),
    });
    const put = cloudflare.calls.find((call) => call.init.method === "PUT");
    const worker = channel === "beta" ? "accounts-beta" : "accounts";
    assert.equal(put.url, `${API}/scripts/${worker}/secrets`);
    assert.deepEqual(JSON.parse(put.init.body), { name: "RP_ID", text: SITE, type: "secret_text" });
    assert.ok(printed.length);
    assert.ok(printed.every((line) => !line.includes(SITE)));
  }
});

test("a site that isn't a domain is refused before anything is asked, without echoing it", async () => {
  for (const relyingPartyId of [undefined, "", "https://fans.test", "fans", "Fans.test"]) {
    const cloudflare = createFakeCloudflare();
    await assert.rejects(
      setRelyingPartyId({ relyingPartyId, fetchImpl: cloudflare.fetchImpl, env: ENV }),
      (error) =>
        error instanceof Error &&
        /as a domain/.test(error.message) &&
        !(relyingPartyId && error.message.includes(relyingPartyId)),
    );
    assert.deepEqual(cloudflare.calls, []);
  }
});

test("an RP_ID already set stays, since every passkey belongs to its site", async () => {
  const cloudflare = createFakeCloudflare({ secrets: [{ name: "RP_ID", type: "secret_text" }] });
  await assert.rejects(
    setRelyingPartyId({
      relyingPartyId: SITE,
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      log: () => {},
    }),
    /already has an RP_ID/,
  );
  assert.ok(!cloudflare.calls.some((call) => call.init.method === "PUT"));
});
