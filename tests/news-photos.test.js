import assert from "node:assert/strict";
import test from "node:test";
import { countClaudeCalls } from "../shared/worker/claude.js";
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
