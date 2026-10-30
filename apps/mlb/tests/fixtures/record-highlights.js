import fs from "node:fs";
import path from "node:path";
import { MLB_API } from "../../worker/src/adapters/mlb.js";
import { nameContentRequest, namePlaysRequest } from "../../worker/src/highlights.js";

// Records what a final's Highlights section reads from MLB for the games named: each game's
// content, trimmed to its clips and its recap story, with each still, the story's photo too, cut
// to the sizes near the ones the Worker picks, and the game's plays. Run with NODE_USE_ENV_PROXY=1 behind a
// proxy.

const STILL_WIDTHS = new Set([480, 640, 960, 1280]);

async function fetchJson(request) {
  const response = await fetch(MLB_API + request);
  if (!response.ok) throw new Error(`${response.status} for ${request}`);
  return response.json();
}

const trimImage = (image) => ({
  title: image?.title,
  cuts: (image?.cuts ?? [])
    .filter((cut) => STILL_WIDTHS.has(cut.width))
    .map(({ width, src }) => ({ width, src })),
});

const trimItem = (item) => ({
  headline: item.headline,
  description: item.description,
  duration: item.duration,
  guid: item.guid,
  image: trimImage(item.image),
  playbacks: (item.playbacks ?? []).map(({ name, url }) => ({ name, url })),
  keywordsAll: (item.keywordsAll ?? [])
    .filter((keyword) => keyword.type === "taxonomy")
    .map(({ type, value }) => ({ type, value })),
});

const trimContent = ({ editorial, highlights }) => ({
  editorial: {
    recap: {
      mlb: {
        headline: editorial?.recap?.mlb?.headline,
        slug: editorial?.recap?.mlb?.slug,
        body: editorial?.recap?.mlb?.body,
        image: trimImage(editorial?.recap?.mlb?.image),
      },
    },
  },
  highlights: { highlights: { items: (highlights?.highlights?.items ?? []).map(trimItem) } },
});

async function recordFixture(name, ids) {
  const fixture = { content: {}, plays: {} };
  for (const id of ids) {
    fixture.content[id] = trimContent(await fetchJson(nameContentRequest(id)));
    fixture.plays[id] = await fetchJson(namePlaysRequest(id));
  }
  const file = path.join(import.meta.dirname, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(fixture));
  console.log(`Wrote ${file}`);
}

const [name, ...ids] = process.argv.slice(2);
if (!name || ids.length === 0) {
  console.error("usage: node apps/mlb/tests/fixtures/record-highlights.js <name> <game id>...");
  process.exit(1);
}
recordFixture(name, ids).catch((error) => {
  console.error(error);
  process.exit(1);
});
