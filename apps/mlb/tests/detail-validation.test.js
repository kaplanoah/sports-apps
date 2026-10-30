import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  describePitcher,
  describeStarters,
  listQualifiedRequest,
  readSpeeds,
} from "../worker/src/adapters/pitchers.js";
import {
  describeClubStarts,
  describeRotationPitcher,
  describeKeptRotationPitcher,
  listScheduleRequest,
} from "../worker/src/adapters/rotations.js";
import { describeHighlights } from "../worker/src/adapters/highlights.js";

const PITCHERS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-06-pitchers.json`, "utf8"),
);
const MEDIA = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-07-highlights.json`, "utf8"),
);
const PERSON = PITCHERS.people[2026][0];
const LOG = PITCHERS.gameLogs[2026].find((person) => person.id === PERSON.id);
const readSide = (person = PERSON, log = LOG) => describePitcher(person, log);

test("recorded pitcher details reject malformed counts, rates, identities and nested starts", () => {
  assert.equal(readSide().line.era, "2.16");
  for (const change of [
    (person) => {
      person.id = -1;
    },
    (person) => {
      person.stats[0].splits[0].stat.era = Infinity;
    },
    (person) => {
      person.stats[0].splits[0].stat.gamesStarted = 1.5;
    },
    (person) => {
      person.stats[0].splits[0].stat.strikeoutsPer9Inn = "NaN";
    },
    (person) => {
      person.stats.find(
        (entry) => entry.type.displayName === "pitchArsenal",
      ).splits[0].stat.percentage = 2;
    },
  ]) {
    const person = structuredClone(PERSON);
    change(person);
    assert.throws(() => readSide(person), /Invalid sports data/);
  }
  const log = structuredClone(LOG);
  log.stats[0].splits
    .filter((game) => game.stat.gamesStarted)
    .sort((first, second) => second.date.localeCompare(first.date))[0].stat.runs = -1;
  assert.throws(() => readSide(PERSON, log), /Invalid sports data/);
  const empty = { ...PERSON, stats: [] };
  assert.deepEqual(
    [readSide(empty, { stats: [{ splits: [] }] }).line, readSide(empty, null).starts],
    [null, []],
  );
});

test("recorded qualified starters reject bad values instead of saving them as missing ranks", () => {
  const qualified = structuredClone(PITCHERS.answers[listQualifiedRequest(2026)]);
  const speeds = readSpeeds(PITCHERS.people[2026]);
  assert.ok(describeStarters(qualified, speeds).starters.length > 20);
  for (const [key, value] of [
    ["era", "Infinity"],
    ["walksPer9Inn", -1],
  ]) {
    const changed = structuredClone(qualified);
    changed.stats[0].splits[0].stat[key] = value;
    assert.throws(() => describeStarters(changed, speeds), /Invalid sports data/);
  }
  assert.deepEqual(describeStarters({ stats: [] }, new Map()), { starters: [] });
  assert.throws(() => describeStarters({}, new Map()), /Invalid sports/);
});

test("recorded rotation pitchers and club starts validate their complete saved records", () => {
  const pitcher = describeRotationPitcher(LOG);
  assert.ok(pitcher.starts.length > 0);
  assert.throws(() => describeRotationPitcher({ ...LOG, id: 0 }), /Invalid sports data/);
  const kept = readSide();
  assert.throws(
    () => describeKeptRotationPitcher({ ...kept, lastName: "" }),
    /Invalid sports data/,
  );
  const schedule = PITCHERS.answers[listScheduleRequest(null, "2026-09-22", "2026-10-06")];
  const parts = {
    club: "CLE",
    from: "2026-09-22",
    through: "2026-10-06",
    schedule,
    pitchers: new Map([[pitcher.id, pitcher]]),
  };
  assert.equal(describeClubStarts(parts).club, "CLE");
  assert.throws(() => describeClubStarts({ ...parts, from: "invalid" }), /Invalid sports data/);
  assert.deepEqual(
    describeClubStarts({ ...parts, schedule: { dates: [] }, pitchers: new Map() }).games,
    [],
  );
});

test("recorded MLB highlights validate nested scores, clip fields and identities", () => {
  const id = Object.keys(MEDIA.content)[0];
  assert.ok(describeHighlights(id, MEDIA.content[id], MEDIA.plays[id]).plays.length);
  const feed = structuredClone(MEDIA.plays[id]);
  feed.liveData.plays.allPlays.find((play) => play.about.isScoringPlay).result.awayScore = -1;
  assert.throws(() => describeHighlights(id, MEDIA.content[id], feed), /Invalid sports data/);
  const content = structuredClone(MEDIA.content[id]);
  for (const item of content.highlights.highlights.items) item.duration = "-1";
  assert.throws(() => describeHighlights(id, content, MEDIA.plays[id]), /Invalid sports data/);
  assert.throws(
    () => describeHighlights("", MEDIA.content[id], MEDIA.plays[id]),
    /Invalid sports data/,
  );
  assert.deepEqual(
    describeHighlights(
      id,
      { highlights: { highlights: { items: [] } } },
      { liveData: { plays: { allPlays: [] } } },
    ),
    { id, recap: null, story: null, plays: [] },
  );
});
