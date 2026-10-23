import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { listAppStylesheets, readDeclarations, readRule } from "./css-rules.js";
import { REPO_ROOT } from "./repo-files.js";
import {
  drawSpread,
  isNearlyRanked,
  placeOnRange,
  rankAmong,
  renderPlacedRow,
  renderRankRow,
  renderSpreadCurve,
} from "../shared/page/rank-curve.js";

test("the curve spreads across from the lowest number to the highest, its peak at the top, with the player's mark on it", () => {
  const { area, edge, left, top } = drawSpread([10, 10, 10, 20], 20);
  assert.match(area, /^M0,20 L0\.0,2\.0 .* L100,20 Z$/);
  assert.match(edge, /^M0\.0,2\.0 /);
  assert.equal(left, 100);
  assert.ok(top > 10 && top < 100);
  assert.equal(drawSpread([5], 5).left, 50);
});

test("a fewest-first curve runs from the most to the fewest, so the mark sits further right the fewer", () => {
  const values = [0.5, 1.2, 2.6, 4];
  const most = drawSpread(values, 2.6);
  const fewest = drawSpread(values, 2.6, true);
  assert.equal(fewest.left.toFixed(1), (100 - most.left).toFixed(1));
  assert.equal(fewest.top.toFixed(3), most.top.toFixed(3));
  assert.ok(drawSpread(values, 0.5, true).left > drawSpread(values, 4, true).left);
  assert.equal(fewest.edge.split(" L").length, most.edge.split(" L").length);
  assert.notEqual(fewest.edge, most.edge);
});

test("a mark for a number past either end of the curve stops at that end, on the curve there", () => {
  const values = [60, 70, 70, 90];
  assert.deepEqual(drawSpread(values, 100).left, 100);
  assert.deepEqual(drawSpread(values, 100).top, drawSpread(values, 90).top);
  assert.deepEqual(drawSpread(values, 40).left, 0);
  assert.deepEqual(drawSpread(values, 40).top, drawSpread(values, 60).top);
  assert.deepEqual(drawSpread(values, 40, true).left, 100);
  assert.match(
    String(renderSpreadCurve(values, [{ value: 100, isProvisional: true }])),
    /left: 100\.0%/,
  );
});

const CURVE_STYLES = fileURLToPath(new URL("shared/page/rank-curve.css", REPO_ROOT));

/** @param {import("./css-rules.js").Declaration[]} declarations */
const findLineRules = (declarations) =>
  declarations.filter((declaration) =>
    /\.player-curve (i\b|:is\([^)]*\bi\b)/.test(readRule(declaration)),
  );

test("a curve's lines are borders, which Safari keeps a whole number of screen pixels wide wherever they fall", () => {
  const lines = findLineRules(readDeclarations(CURVE_STYLES));
  assert.deepEqual(
    lines.filter(({ property }) => property === "width").map(({ value }) => value),
    ["0"],
  );
  assert.ok(lines.some(({ property }) => property.startsWith("border-left")));
  assert.deepEqual(
    lines.filter(({ property }) => property.startsWith("background")),
    [],
  );
});

test("no app sizes or fills a curve's lines itself, only their color through --rank-mark", () => {
  for (const path of listAppStylesheets()) {
    assert.deepEqual(
      findLineRules(readDeclarations(path))
        .map(({ property }) => property)
        .filter((property) => property !== "--rank-mark"),
      [],
      path,
    );
  }
});

test("on a phone, a ranked line is 5 screen pixels wide and a would-be hairline 2", () => {
  // Safari rounds a border's width down to whole screen pixels, 3 to a point on an iPhone.
  const countPhonePixels = (/** @type {string} */ width) => Math.floor(parseFloat(width) * 3);
  const declarations = readDeclarations(CURVE_STYLES);
  /** @param {string} rule @param {string} property */
  const readWidth = (rule, property) =>
    declarations.find((each) => readRule(each) === rule && each.property === property)?.value ?? "";
  assert.equal(countPhonePixels(readWidth(".player-curve i", "border-left")), 5);
  assert.equal(countPhonePixels(readWidth(".player-curve i.provisional", "border-left-width")), 2);
});

test("a rank counts only the players strictly better, so tied players share one, and the fewest can rank first", () => {
  const values = [0.25, 0.3, 0.3, 0.28];
  assert.deepEqual(rankAmong(values, 0.3, { isRanked: true }), {
    value: 0.3,
    rank: 1,
    count: 4,
    values: [0.25, 0.28, 0.3, 0.3],
  });
  assert.equal(rankAmong(values, 0.28, { isRanked: true }).rank, 3);
  assert.equal(rankAmong(values, 0.25, { isRanked: true, isFewestFirst: true }).rank, 1);
  assert.equal(rankAmong(values, 0.29, { isRanked: false }).rank, null);
});

test("a row shows the label, the number as written, the curve, and the rank, or no curve or rank for an unranked player", () => {
  const ranked = String(
    renderRankRow({
      label: "AVG",
      shown: ".282",
      stat: rankAmong([0.25, 0.282], 0.282, { isRanked: true }),
    }),
  );
  assert.match(ranked, /player-rank-label">AVG</);
  assert.match(ranked, /player-rank-value tabular">\.282</);
  assert.match(ranked, /<svg/);
  assert.match(ranked, /<span class="player-rank">1st of 2<\/span>/);
  const unranked = String(
    renderRankRow({
      label: "AVG",
      shown: ".300",
      stat: rankAmong([0.25], 0.3, { isRanked: false }),
    }),
  );
  assert.doesNotMatch(unranked, /<svg|\d of /);
});

test("a number's place on a range is its share of it, the fewest on the right when fewer ranks first, held at either end, and nowhere without a range", () => {
  assert.equal(placeOnRange(85, [80, 100]), 25);
  assert.equal(placeOnRange(85, [80, 100], true), 75);
  assert.equal(placeOnRange(120, [80, 100]), 100);
  assert.equal(placeOnRange(70, [80, 100]), 0);
  assert.equal(placeOnRange(2 / 3, [0, 1]), 66.7);
  assert.equal(placeOnRange(null, [80, 100]), null);
  assert.equal(placeOnRange(85, null), null);
  assert.equal(placeOnRange(85, [90, 90]), null);
});

test("a placed row shows the label, the number, a line with the other's dot under its own, and the other number, leaving out a dot with no place", () => {
  const row = String(
    renderPlacedRow({
      label: "PPG",
      own: { shown: "89.5", at: 62.1 },
      other: { shown: "86.5", at: 44.4 },
    }),
  );
  assert.match(row, /player-rank-label">PPG</);
  assert.match(row, /player-rank-value tabular">89\.5</);
  assert.match(
    row,
    /<span class="placed-line" aria-hidden="true"><span><b class="placed-range" style="left: calc\(-1 \* var\(--placed-inset\)\); right: calc\(-1 \* var\(--placed-inset\)\)"><\/b><i class="other" style="left: 44\.4%"><\/i><i class="own" style="left: 62\.1%"><\/i><\/span><\/span>/,
  );
  assert.match(row, /placed-other tabular">86\.5</);
  const unplaced = String(
    renderPlacedRow({
      label: "Road",
      own: { shown: "0-0", at: null },
      other: { shown: "1-5", at: 16.7 },
    }),
  );
  assert.doesNotMatch(unplaced, /class="own"/);
  assert.match(unplaced, /class="other"/);
});

test("a placed row's line is solid over its range and dashed past either end of it, each stretch reaching the line's end where it ends there", () => {
  /** @param {[number, number]} range */
  const readLine = (range) =>
    String(
      renderPlacedRow({
        label: "R/G",
        own: { shown: "4.00", at: 27.7 },
        other: { shown: "3.52", at: 0 },
        range,
      }),
    ).match(/<span class="placed-line" aria-hidden="true"><span>(.*?)<i /)?.[1];
  const end = "calc(-1 * var(--placed-inset))";
  assert.equal(
    readLine([27.7, 100]),
    `<b class="placed-past toward-start" style="left: ${end}; right: 72.3%"></b>` +
      `<b class="placed-range" style="left: 27.7%; right: ${end}"></b>`,
  );
  assert.equal(
    readLine([0, 80.1]),
    `<b class="placed-range" style="left: ${end}; right: 19.9%"></b>` +
      `<b class="placed-past toward-end" style="left: 80.1%; right: ${end}"></b>`,
  );
  assert.equal(
    readLine([12.5, 75]),
    `<b class="placed-past toward-start" style="left: ${end}; right: 87.5%"></b>` +
      `<b class="placed-range" style="left: 12.5%; right: 25%"></b>` +
      `<b class="placed-past toward-end" style="left: 75%; right: ${end}"></b>`,
  );
});

test("a player not yet ranked has where he would rank once he's a quarter of the way to qualifying, and not before", () => {
  const values = [0.25, 0.3, 0.3, 0.28];
  assert.equal(isNearlyRanked(0.25), true);
  assert.equal(isNearlyRanked(0.24), false);
  assert.equal(isNearlyRanked(null), false);
  assert.deepEqual(rankAmong(values, 0.29, { isRanked: false, progress: 0.25 }), {
    value: 0.29,
    rank: null,
    wouldRank: 3,
    count: 4,
    values: [0.25, 0.28, 0.3, 0.3],
  });
  assert.equal(rankAmong(values, 0.29, { isRanked: false, progress: 0.24 }).wouldRank, undefined);
  assert.equal(
    rankAmong(values, 0.26, { isRanked: false, isFewestFirst: true, progress: 1 }).wouldRank,
    2,
  );
  assert.equal(rankAmong(values, 0.3, { isRanked: true, progress: 0.5 }).wouldRank, undefined);
  assert.equal(rankAmong(values, null, { isRanked: false, progress: 0.5 }).wouldRank, undefined);
});

test("where a player would rank shows as a line on the curve with no dot, and the rank written as would be", () => {
  const row = String(
    renderRankRow({
      label: "AVG",
      shown: ".290",
      stat: rankAmong([0.25, 0.3], 0.29, { isRanked: false, progress: 0.5 }),
    }),
  );
  assert.match(row, /<i class="provisional" style="left: [\d.]+%; top: [\d.]+%"><\/i>/);
  assert.doesNotMatch(row, /<b /);
  assert.match(row, /<span class="player-rank">would be 2nd<\/span>/);
  const curve = String(
    renderSpreadCurve(
      [1, 2, 3],
      [
        { value: 2, className: "home", isProvisional: true },
        { value: 3, className: "away" },
      ],
    ),
  );
  assert.match(
    curve,
    /<i class="home provisional" [^>]*><\/i><i class="away" [^>]*><\/i><b class="away"/,
  );
});

test("a curve's marks sit in a box of their own over it, which an app can draw inside the curve's ends", () => {
  const curve = String(
    renderSpreadCurve(
      [1, 2, 3],
      [
        { value: 3, className: "home" },
        { value: 1, className: "away" },
      ],
    ),
  );
  assert.match(
    curve,
    /<\/svg>\s*<span><i class="home" [^>]*><\/i><b class="home" [^>]*><\/b><i class="away"/,
  );
});
