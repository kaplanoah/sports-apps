import assert from "node:assert/strict";
import test from "node:test";
import { countClaudeCalls, stopAfterRefusal } from "../shared/worker/claude.js";
import { frameNewsPhotos } from "../shared/worker/news-photos.js";
import { createJobStorage } from "./job-context.js";
import { createPng } from "./photo-files.js";

const PHOTO = "https://photos.example/tall.jpg";

test("a tall photo a Worker without the claude binding couldn't ask about keeps its size and every try", async (context) => {
  context.mock.method(console, "error", () => {});
  const storage = createJobStorage();
  const photoContext = {
    storage,
    claude: countClaudeCalls(undefined, () => {}),
    canAsk: async () => true,
    fetchImpl: async () => new Response(createPng(683, 1024)),
  };

  for (let run = 0; run < 4; run += 1) {
    const { failed } = await frameNewsPhotos(photoContext, [PHOTO]);
    assert.equal(failed, 1);
  }

  const [frame] = (await storage.list("photo:")).values();
  assert.equal(frame.width, 683);
  assert.equal(frame.tries, undefined);
  assert.equal(frame.frameTop, undefined);
});

test("a key Claude turns away costs one ask a run, and every photo still gets its size", async (context) => {
  context.mock.method(console, "error", () => {});
  const storage = createJobStorage();
  let asks = 0;
  const claude = {
    readConfig: async () => ({ configured: true }),
    requestClaude: async () => {
      asks += 1;
      return { problem: "Claude answered 401: invalid x-api-key", status: 401 };
    },
  };
  const urls = Array.from({ length: 30 }, (_, index) => `https://photos.example/${index}.jpg`);

  for (let run = 0; run < 3; run += 1)
    await frameNewsPhotos(
      {
        storage,
        claude: stopAfterRefusal(claude),
        canAsk: async () => true,
        fetchImpl: async () => new Response(createPng(683, 1024)),
      },
      urls,
    );

  const frames = [...(await storage.list("photo:")).values()];
  assert.equal(asks, 3);
  assert.equal(frames.length, urls.length);
  assert.ok(frames.every((frame) => frame.width === 683 && frame.tries === undefined));
});
