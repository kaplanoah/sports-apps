import assert from "node:assert/strict";
import test from "node:test";
import { createClaudeService } from "../worker/src/service.js";

const KEY = "sk-test-key";
const SCHEMA = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
const REQUEST = {
  model: "claude-haiku-5-5",
  max_tokens: 64,
  output_config: { effort: "low" },
  messages: [{ role: "user", content: "Is it ok?" }],
};
const OPTIONS = { timeoutMs: 1000, request: REQUEST, schema: SCHEMA };

/**
 * A Messages API that answers each call with `answer` and keeps each request it got.
 * @param {(init: RequestInit) => Response} answer
 */
function createMessages(answer) {
  /** @type {{ url: string, init: RequestInit }[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return answer(init);
  };
  return { calls, fetchImpl };
}

const answerFinished = () =>
  Response.json({
    stop_reason: "end_turn",
    content: [{ type: "text", text: '{"ok":true}' }],
    usage: { input_tokens: 10, output_tokens: 2 },
  });

test("a request goes to the Messages API with the service's key and the answer's schema", async () => {
  const messages = createMessages(answerFinished);
  const service = createClaudeService({ ANTHROPIC_API_KEY: ` ${KEY}\n` }, messages.fetchImpl);
  assert.deepEqual(await service.requestClaude(OPTIONS), {
    answer: { ok: true },
    usage: { input_tokens: 10, output_tokens: 2 },
  });
  assert.equal(messages.calls.length, 1);
  const [{ url, init }] = messages.calls;
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, {
    "content-type": "application/json",
    "x-api-key": KEY,
    "anthropic-version": "2023-06-01",
  });
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(String(init.body)), {
    ...REQUEST,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
  });
});

test("without a key the service says so, asks nothing, and its health names the secret alone", async () => {
  for (const env of [{}, { ANTHROPIC_API_KEY: "  " }]) {
    const messages = createMessages(answerFinished);
    const service = createClaudeService(
      { ...env, VERSION: { tag: "abc1234" } },
      messages.fetchImpl,
    );
    assert.deepEqual(await service.readConfig(), { configured: false });
    assert.deepEqual(await service.requestClaude(OPTIONS), {
      problem: "The claude service has no ANTHROPIC_API_KEY secret",
    });
    assert.deepEqual(await service.readHealth(), {
      ok: false,
      release: "abc1234",
      problem: "The claude service has no ANTHROPIC_API_KEY secret",
    });
    assert.equal(messages.calls.length, 0);
  }
});

test("with a key the service is configured, and its health never shows the key", async () => {
  const service = createClaudeService({ ANTHROPIC_API_KEY: KEY, VERSION: { tag: "abc1234" } });
  assert.deepEqual(await service.readConfig(), { configured: true });
  assert.deepEqual(await service.readHealth(), { ok: true, release: "abc1234" });
  assert.doesNotMatch(JSON.stringify(await service.readHealth()), new RegExp(KEY));
});

test("a refusal comes back as a problem with the API's status, never the key", async () => {
  const messages = createMessages(() =>
    Response.json({ error: { message: `invalid x-api-key ${KEY}` } }, { status: 401 }),
  );
  const service = createClaudeService({ ANTHROPIC_API_KEY: KEY }, messages.fetchImpl);
  assert.deepEqual(await service.requestClaude(OPTIONS), {
    problem: "Claude answered 401: invalid x-api-key <key>",
    status: 401,
  });
});

test("an answer cut short, or a call that throws, comes back as a problem without the key", async () => {
  const cutShort = createMessages(() => Response.json({ stop_reason: "max_tokens", content: [] }));
  assert.deepEqual(
    await createClaudeService({ ANTHROPIC_API_KEY: KEY }, cutShort.fetchImpl).requestClaude(
      OPTIONS,
    ),
    { problem: "Claude stopped without finishing: max_tokens" },
  );
  /** @type {typeof fetch} */
  const throwing = async () => {
    throw new Error(`connection to ${KEY} reset`);
  };
  assert.deepEqual(
    await createClaudeService({ ANTHROPIC_API_KEY: KEY }, throwing).requestClaude(OPTIONS),
    { problem: "connection to <key> reset" },
  );
});
