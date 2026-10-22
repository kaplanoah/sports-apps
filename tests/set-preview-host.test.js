import test from "node:test";
import assert from "node:assert/strict";
import { setPreviewHost } from "../worker/set-preview-host.mjs";
import { createFakeCloudflare } from "./fake-cloudflare.js";

const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct123" };
const API = "https://api.cloudflare.com/client/v4";
const ZONES = [
  { id: "zone-other", name: "other.example" },
  { id: "zone-sports", name: "sports.example" },
];

test("the host is added to the app's beta Worker for its previews alone, and never printed", async () => {
  const cloudflare = createFakeCloudflare({ zones: ZONES });
  const printed = [];
  await setPreviewHost({
    app: "wnba",
    host: "wnba-previews.sports.example",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    log: (line) => printed.push(line),
  });

  const puts = cloudflare.calls.filter((call) => call.init.method === "PUT");
  assert.deepEqual(
    puts.map((call) => [call.url, JSON.parse(call.init.body)]),
    [
      [
        `${API}/accounts/acct123/workers/domains`,
        {
          hostname: "wnba-previews.sports.example",
          service: "wnba-app-beta",
          zone_id: "zone-sports",
          environment: "production",
          enabled: false,
          previews_enabled: true,
        },
      ],
    ],
  );
  assert.ok(printed.length);
  for (const line of printed) assert.doesNotMatch(line, /previews\.sports\.example/);
});

test("a host deeper than one level under its domain, whose previews would get no certificate, or that isn't a host, is refused before any change", async () => {
  /** @type {[string | undefined, RegExp][]} */
  const refusals = [
    ["mlb.previews.sports.example", /one level under its domain/],
    ["sports.example", /one level under its domain/],
    ["https://mlb-previews.sports.example/", /Name the previews' host/],
    [undefined, /Name the previews' host/],
  ];
  for (const [host, refusal] of refusals) {
    const cloudflare = createFakeCloudflare({ zones: ZONES });
    await assert.rejects(
      setPreviewHost({
        app: "mlb",
        host,
        fetchImpl: cloudflare.fetchImpl,
        env: ENV,
        log: () => {},
      }),
      refusal,
      String(host),
    );
    assert.ok(!cloudflare.calls.some((call) => call.init.method === "PUT"), String(host));
  }
});
