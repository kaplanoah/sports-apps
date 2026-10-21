import test from "node:test";
import assert from "node:assert/strict";
import { setPageHost } from "../worker/set-page-host.mjs";
import { createFakeCloudflare } from "./fake-cloudflare.js";

const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct123" };
const API = "https://api.cloudflare.com/client/v4";
const WITH_CODE = [{ name: "ACCESS_CODE", type: "secret_text" }];
const ZONES = [
  { id: "zone-other", name: "other.example" },
  { id: "zone-sports", name: "sports.example" },
];

test("the address is pointed at the app's Worker on its domain, named in a secret, and printed", async () => {
  const cloudflare = createFakeCloudflare({ secrets: WITH_CODE, zones: ZONES });
  const printed = [];
  const url = await setPageHost({
    app: "mlb",
    host: "mlb.sports.example",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    log: (line) => printed.push(line),
  });

  assert.equal(url, "https://mlb.sports.example/");
  assert.ok(printed.includes(`Page address: ${url}`));
  const puts = cloudflare.calls.filter((call) => call.init.method === "PUT");
  assert.deepEqual(
    puts.map((call) => [call.url, JSON.parse(call.init.body)]),
    [
      [
        `${API}/accounts/acct123/workers/domains`,
        {
          hostname: "mlb.sports.example",
          service: "mlb-app",
          zone_id: "zone-sports",
          environment: "production",
        },
      ],
      [
        `${API}/accounts/acct123/workers/scripts/mlb-app/secrets`,
        { name: "PAGE_HOST", text: "mlb.sports.example", type: "secret_text" },
      ],
    ],
  );
});

test("a Worker without an access code gets no address without its key", async () => {
  const cloudflare = createFakeCloudflare({ zones: ZONES });
  await assert.rejects(
    setPageHost({
      app: "mlb",
      host: "mlb.sports.example",
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      log: () => {},
    }),
    /set-access-code/,
  );
  assert.ok(!cloudflare.calls.some((call) => call.init.method === "PUT"));
});

test("an address on no domain in the account, or no address at all, changes nothing", async () => {
  for (const host of ["mlb.elsewhere.example", undefined, "https://mlb.sports.example/"]) {
    const cloudflare = createFakeCloudflare({ secrets: WITH_CODE, zones: ZONES });
    await assert.rejects(
      setPageHost({ app: "mlb", host, fetchImpl: cloudflare.fetchImpl, env: ENV, log: () => {} }),
      /No domain|Name the page's address/,
      String(host),
    );
    assert.ok(!cloudflare.calls.some((call) => call.init.method === "PUT"), String(host));
  }
});
