import test from "node:test";
import assert from "node:assert/strict";
import { createIdentityDocuments } from "../../../shared/worker/identity-documents.js";
import { createIdentityLookup } from "../../../shared/worker/identity.js";
import {
  createRequestBudget,
  RequestBudgetExhausted,
} from "../../../shared/worker/request-budget.js";
import { createDurableObjectContext } from "../../../tests/durable-object-context.js";
import { createDocs } from "../../../tests/job-context.js";
import { identityPolicy } from "../worker/src/identity-policy.js";
import {
  createEspnGameReader,
  nameEspnMatchKey,
  nameSummaryRequest,
} from "../worker/src/adapters/lead.js";
import {
  OPAQUE_GAMES,
  OPAQUE_PLAYER,
  describeLeagueObservations,
  describeEspnIdentities,
} from "./opaque-identity-fixtures.js";

async function createMappedGames() {
  const { ctx, stored } = createDurableObjectContext();
  const identities = createIdentityDocuments(ctx.storage, identityPolicy);
  const docs = createDocs();
  await identities.lookup.save(describeLeagueObservations());
  await identities.saveVendorGames(describeEspnIdentities(), 0, docs);
  return { ctx, stored, identities, docs };
}

test("opaque WNBA mappings keep explicit facts and different league and ESPN identifiers", async () => {
  const { identities } = await createMappedGames();
  for (const game of OPAQUE_GAMES) {
    assert.notEqual(game.id, game.leagueId);
    assert.notEqual(game.id, game.espnId);
    assert.equal(await identities.lookup.read("game", "wnba", game.leagueId), game.id);
    assert.equal(await identities.lookup.read("game", "espn", game.espnId), game.id);
    const entry = await identities.lookup.readEntry("game", game.id);
    assert.deepEqual(entry.facts, game.facts);
    assert.deepEqual(entry.vendors, { wnba: game.leagueId, espn: game.espnId });
  }
  assert.equal(
    await identities.lookup.read("player", "wnba", OPAQUE_PLAYER.leagueId),
    OPAQUE_PLAYER.id,
  );
});

test("the existing identity writer persists opaque ESPN match documents for the summary reader", async () => {
  const { ctx, docs } = await createMappedGames();
  const identities = createIdentityDocuments(ctx.storage, identityPolicy);
  await identities.saveVendorGames(describeEspnIdentities(), 0, docs);
  const requests = [];
  const budget = createRequestBudget(async (url) => {
    requests.push(url);
    return Response.json({ source: "fixture-summary" });
  }, OPAQUE_GAMES.length);
  const reader = createEspnGameReader({ fetchImpl: budget.fetchImpl });
  for (const game of OPAQUE_GAMES) {
    assert.deepEqual(await docs.read(nameEspnMatchKey(game.id)), {
      id: game.id,
      eventId: game.espnId,
      away: game.facts.away,
      home: game.facts.home,
      start: game.facts.start,
    });
    const summary = await reader.fetchSummary({ id: game.id, ...game.facts }, docs.read);
    assert.deepEqual(summary, { source: "fixture-summary" });
  }
  assert.deepEqual(
    requests,
    OPAQUE_GAMES.map((game) => nameSummaryRequest(game.espnId)),
  );
  assert.equal(budget.remaining(), 0);
});

test("a partial vendor identity batch leaves other saved opaque matches and facts intact", async () => {
  const { ctx, docs } = await createMappedGames();
  const saved = structuredClone([...docs.stored]);
  const identities = createIdentityDocuments(ctx.storage, identityPolicy);
  await identities.saveVendorGames([describeEspnIdentities()[1]], 0, docs);
  assert.deepEqual([...docs.stored], saved);
  for (const game of OPAQUE_GAMES)
    assert.equal(await identities.lookup.read("game", "espn", game.espnId), game.id);
});

test("an exhausted store request budget stops an opaque summary read without losing its match", async () => {
  const { docs } = await createMappedGames();
  const saved = structuredClone([...docs.stored]);
  const requests = [];
  const budget = createRequestBudget(async (url) => {
    requests.push(url);
    return Response.json({ source: "fixture-summary" });
  }, 1);
  const reader = createEspnGameReader({ fetchImpl: budget.fetchImpl });
  const [first, second] = OPAQUE_GAMES;
  await reader.fetchSummary({ id: first.id, ...first.facts }, docs.read);
  await assert.rejects(
    reader.fetchSummary({ id: second.id, ...second.facts }, docs.read),
    RequestBudgetExhausted,
  );
  assert.deepEqual(requests, [nameSummaryRequest(first.espnId)]);
  assert.deepEqual([...docs.stored], saved);
});

test("a cold WNBA store does not invent a league game or match document from an ESPN identity", async () => {
  const { ctx } = createDurableObjectContext();
  const identities = createIdentityDocuments(ctx.storage, identityPolicy);
  const docs = createDocs();
  await identities.saveVendorGames(describeEspnIdentities(), 0, docs);
  assert.equal(docs.stored.size, 0);
  for (const game of OPAQUE_GAMES)
    assert.equal(await identities.lookup.read("game", "espn", game.espnId), null);
  const status = await identities.readStatus();
  assert.equal(status.games, 0);
  assert.equal(status.unmatched, OPAQUE_GAMES.length);
});

test("opaque WNBA mapping reads remain scoped to league, vendor and entity type", async () => {
  const { ctx, identities } = await createMappedGames();
  const otherLeague = createIdentityLookup(ctx.storage, "nba");
  for (const game of OPAQUE_GAMES) {
    assert.equal(await otherLeague.read("game", "espn", game.espnId), null);
    assert.equal(await identities.lookup.read("player", "espn", game.espnId), null);
    assert.equal(await identities.lookup.read("game", "balldontlie", game.espnId), null);
    assert.equal(await identities.lookup.read("game", "wnba", game.id), null);
  }
});

test("opaque match and identity reads make no vendor requests or storage changes", async () => {
  const { ctx, stored, docs } = await createMappedGames();
  const identities = createIdentityDocuments(ctx.storage, identityPolicy);
  const before = structuredClone([...stored]);
  const savedDocs = structuredClone([...docs.stored]);
  for (const game of OPAQUE_GAMES) {
    const internalId = await identities.lookup.read("game", "espn", game.espnId);
    const entry = await identities.lookup.readEntry("game", internalId);
    assert.equal(entry.vendors.wnba, game.leagueId);
    assert.equal((await docs.read(nameEspnMatchKey(internalId))).eventId, game.espnId);
  }
  assert.deepEqual([...stored], before);
  assert.deepEqual([...docs.stored], savedDocs);
});
