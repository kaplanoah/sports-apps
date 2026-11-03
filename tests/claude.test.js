import assert from "node:assert/strict";
import test from "node:test";
import {
  MissingClaudeBinding,
  countClaudeCalls,
  isClaudeRefusal,
  lacksClaudeKey,
  rememberClaudeConfig,
  requestClaude,
} from "../shared/worker/claude.js";
import { RequestBudgetExhausted, createRequestBudget } from "../shared/worker/request-budget.js";

const OPTIONS = { timeoutMs: 1000, request: { model: "claude-haiku-5-5" }, schema: {} };

/**
 * A claude service that answers each call as given.
 * @param {{ configured?: boolean, result?: import("../shared/worker/claude.js").ClaudeResult }} answers
 * @returns {import("../shared/worker/claude.js").Claude}
 */
const createService = ({ configured = true, result = { answer: {}, usage: {} } } = {}) => ({
  readConfig: async () => ({ configured }),
  requestClaude: async () => result,
});

test("each call to the service is counted as it goes out", async () => {
  let count = 0;
  const claude = countClaudeCalls(createService(), () => {
    count += 1;
  });
  await claude.readConfig();
  await claude.requestClaude(OPTIONS);
  assert.equal(count, 2);
});

test("a call to the service spends a request budget, and one the budget has no request left for never goes out", async () => {
  let fetches = 0;
  const budget = createRequestBudget(async () => {
    fetches += 1;
    return new Response("{}");
  }, 2);
  let calls = 0;
  const service = createService();
  const claude = countClaudeCalls(
    {
      ...service,
      readConfig: async () => {
        calls += 1;
        return await service.readConfig();
      },
    },
    budget.spend,
  );
  await budget.fetchImpl("https://league.example/feed");
  await claude.readConfig();
  assert.equal(budget.remaining(), 0);
  await assert.rejects(claude.readConfig(), RequestBudgetExhausted);
  assert.equal(calls, 1);
  assert.equal(fetches, 1);
});

test("without a CLAUDE binding, each call fails, counting nothing however often it's counted", async () => {
  let count = 0;
  const countCall = () => {
    count += 1;
  };
  const claude = countClaudeCalls(countClaudeCalls(undefined, countCall), countCall);
  await assert.rejects(claude.readConfig(), MissingClaudeBinding);
  await assert.rejects(claude.requestClaude(OPTIONS), /No CLAUDE binding to the claude service/);
  await assert.rejects(requestClaude(claude, OPTIONS), /No CLAUDE binding/);
  assert.equal(count, 0);
});

test("only a missing binding, or Claude turning the key away, is a refusal", async () => {
  const fail = (status) =>
    requestClaude(createService({ result: { problem: "no", status } }), OPTIONS).catch(
      (error) => error,
    );
  assert.equal(isClaudeRefusal(new MissingClaudeBinding()), true);
  assert.equal(isClaudeRefusal(await fail(401)), true);
  assert.equal(isClaudeRefusal(await fail(403)), true);
  assert.equal(isClaudeRefusal(await fail(529)), false);
  assert.equal(isClaudeRefusal(await fail(undefined)), false);
  assert.equal(isClaudeRefusal(new Error("timed out")), false);
});

test("only a service that says it has no key lacks one; one that fails or isn't bound doesn't", async () => {
  assert.equal(await lacksClaudeKey(createService({ configured: false })), true);
  assert.equal(await lacksClaudeKey(createService()), false);
  assert.equal(await lacksClaudeKey(countClaudeCalls(undefined, () => {})), false);
  const broken = {
    ...createService(),
    readConfig: async () => {
      throw new Error("service down");
    },
  };
  assert.equal(await lacksClaudeKey(broken), false);
});

test("an answer comes back as is, and a problem throws with the API's status when it had one", async () => {
  const answered = { answer: { ok: true }, usage: { input_tokens: 3 } };
  assert.deepEqual(await requestClaude(createService({ result: answered }), OPTIONS), answered);
  await assert.rejects(
    requestClaude(
      createService({ result: { problem: "Claude answered 403: no", status: 403 } }),
      OPTIONS,
    ),
    { message: "Claude answered 403: no", status: 403 },
  );
  await assert.rejects(
    requestClaude(createService({ result: { problem: "timed out" } }), OPTIONS),
    (error) => error instanceof Error && error.message === "timed out" && !("status" in error),
  );
});

test("a remembered config is read from the service once, but again after a read that failed", async () => {
  let reads = 0;
  const service = createService();
  const claude = rememberClaudeConfig({
    ...service,
    readConfig: async () => {
      reads += 1;
      if (reads === 1) throw new Error("service down");
      return await service.readConfig();
    },
  });
  await assert.rejects(claude.readConfig(), /service down/);
  assert.deepEqual(await claude.readConfig(), { configured: true });
  assert.deepEqual(await claude.readConfig(), { configured: true });
  assert.equal(reads, 2);
});
