import test from "node:test";
import assert from "node:assert/strict";
import { fetchHighlights } from "../page/js/highlights-fetch.js";

for (const [index, season] of [null, undefined, 2025].entries()) {
  test(`highlights ${season == null ? `omit an unknown season (${String(season)})` : "send the game season"}`, async (context) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "location");
    globalThis.location = /** @type {any} */ ({ href: "https://mlb-app.example/k3y/" });
    context.after(() => {
      if (previous) Object.defineProperty(globalThis, "location", previous);
      else Reflect.deleteProperty(globalThis, "location");
    });
    const requests = [];
    const id = String(849826 + index);
    context.mock.method(globalThis, "fetch", async (url) => {
      requests.push(new URL(String(url)));
      return Response.json({ id, plays: [] });
    });
    assert.deepEqual(await fetchHighlights(id, season), { id, plays: [] });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].searchParams.get("id"), id);
    assert.equal(requests[0].searchParams.get("season"), season == null ? null : String(season));
  });
}
