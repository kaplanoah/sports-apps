import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { proveNativeQuotaAccess } from "../worker/codex-rate-access.mjs";

const expected = {
  repository: "example/repo",
  repositoryId: 9,
  run: 30,
  token: "fake-github-token",
};

/** @param {(fixture:any)=>void} [change] */
function createAccessFixture(change = () => {}) {
  const bytes = Buffer.from("example original public archive");
  const artifact = {
    id: 5,
    name: `production-checked-${"a".repeat(40)}`,
    expired: false,
    size_in_bytes: bytes.length,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    workflow_run: { id: 12, repository_id: 9 },
  };
  const fixture = { artifact, metadataStatus: 200, archiveStatus: 200, tampered: false, calls: [] };
  change(fixture);
  fixture.fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, "https://api.github.com");
    assert.equal(options.method ?? "GET", "GET");
    assert.equal(options.headers.authorization, "Bearer fake-github-token");
    fixture.calls.push(new URL(url).pathname);
    if (new URL(url).pathname.endsWith("/zip"))
      return new Response(fixture.tampered ? Buffer.from("changed") : bytes, {
        status: fixture.archiveStatus,
      });
    return Response.json({ artifacts: [artifact] }, { status: fixture.metadataStatus });
  };
  return fixture;
}

test("current permissions must read another run's original digest-verified archive", async () => {
  const fixture = createAccessFixture();
  const result = await proveNativeQuotaAccess(expected, fixture);
  assert.equal(result.passed, true);
  assert.equal(result.metadataRead, true);
  assert.equal(result.archiveRead, true);
  assert.equal(result.artifact, 5);
  assert.equal(fixture.calls.length, 2);
});

test("a listing permission does not pretend archive access and missing permissions remain numeric", async () => {
  for (const change of [
    (fixture) => {
      fixture.metadataStatus = 403;
    },
    (fixture) => {
      fixture.archiveStatus = 403;
    },
  ]) {
    const result = await proveNativeQuotaAccess(expected, createAccessFixture(change));
    assert.equal(result.passed, false);
    assert.equal(result.archiveRead, false);
    assert.equal(result.status, 403);
    assert.equal(JSON.stringify(result).includes("fake-github-token"), false);
  }
});

test("same-run, expired and wrong archives cannot prove cross-run quota access", async () => {
  for (const change of [
    (fixture) => {
      fixture.artifact.workflow_run.id = 30;
    },
    (fixture) => {
      fixture.artifact.expired = true;
    },
    (fixture) => {
      fixture.artifact.name = "private-model-output";
    },
  ])
    assert.equal(
      (await proveNativeQuotaAccess(expected, createAccessFixture(change))).passed,
      false,
    );
  await assert.rejects(
    proveNativeQuotaAccess(
      expected,
      createAccessFixture((fixture) => {
        fixture.tampered = true;
      }),
    ),
    /digest mismatch/,
  );
});
