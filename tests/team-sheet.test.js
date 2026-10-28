import { test } from "node:test";
import assert from "node:assert/strict";
import { html } from "../shared/page/html.js";
import { renderSheetPart } from "../shared/page/sheet-part.js";
import { listOpenSheets, reopenSheets } from "../shared/page/sheet-reopen.js";
import {
  refreshTeamSheet,
  renderTeamDetail,
  renderTeamSheetButton,
  renderTeamStats,
  renderTitles,
  startTeamSheet,
} from "../shared/page/team-sheet.js";
import { stripTags } from "./text.js";

// Stand-ins for the page's team sheet, a dialog of its own here, and its parts, on a wide screen
// without motion, whose body never changes size.
function createPage() {
  globalThis.matchMedia = /** @type {any} */ (
    (query) => ({ matches: query.includes("reduced-motion") })
  );
  globalThis.ResizeObserver = /** @type {any} */ (
    class {
      observe() {}
    }
  );
  const dialog = Object.assign(new EventTarget(), {
    id: "teamSheet",
    open: false,
    scrollTop: 0,
    showModal() {
      dialog.open = true;
    },
    close() {
      dialog.open = false;
      dialog.dispatchEvent(new Event("close"));
    },
    closest: () => dialog,
    contains: () => true,
    getAttribute: () => null,
    setAttribute() {},
    removeAttribute() {},
    querySelector: () => null,
  });
  const elements = {
    teamSheet: dialog,
    teamTitle: { innerHTML: "" },
    teamNote: { innerHTML: "" },
    teamBody: Object.assign(new EventTarget(), { innerHTML: "", querySelector: () => null }),
  };
  const document = Object.assign(new EventTarget(), {
    activeElement: null,
    fonts: new EventTarget(),
    getElementById: (id) => elements[id],
  });
  globalThis.document = /** @type {any} */ (document);
  return { dialog, elements, document };
}

// A tap on something inside a button whose data-team names the team, or inside none for null.
function tapTeam(document, team) {
  const event = new Event("click");
  Object.defineProperty(event, "target", {
    value: { closest: () => (team ? { dataset: { team } } : null) },
  });
  document.dispatchEvent(event);
}

const BOS_TITLES = [2018, 2013, 2007, 2004, 1918, 1916, 1915];

const page = createPage();
let season = "the season so far";
/** @param {string} team */
function renderSheet(team) {
  const sheet = { heading: html`<b>${team}</b>`, note: `${team} note` };
  return { ...sheet, body: team === "BOS" ? renderTitles(BOS_TITLES) : html`<p>${season}</p>` };
}

/** @type {string[]} */
const filledSections = [];
let sectionsRead = "nothing read";

startTeamSheet({
  isTeam: (team) => ["NYY", "BOS", "NYM"].includes(team),
  renderSheet,
  fillSections: (team) => filledSections.push(team),
  sectionsKeeper: {
    read: () => sectionsRead,
    reopen: (saved) => filledSections.push(`took back ${saved}`),
  },
});

// A tap on the titles' button for the rest, or on something else in the sheet's body.
function tapInBody(body, isOnMore) {
  const event = new Event("click");
  Object.defineProperty(event, "target", {
    value: { closest: (selector) => (isOnMore && selector === ".team-titles-more" ? {} : null) },
  });
  body.dispatchEvent(event);
}

test("a tap on a team's button opens its sheet, and a tap on another's shows that one in its place", () => {
  tapTeam(page.document, "NYY");
  assert.equal(page.dialog.open, true);
  assert.equal(page.elements.teamTitle.innerHTML, "<b>NYY</b>");
  assert.equal(page.elements.teamNote.innerHTML, "NYY note");
  tapTeam(page.document, "BOS");
  assert.equal(page.elements.teamTitle.innerHTML, "<b>BOS</b>");
  page.dialog.close();
});

test("a tap on a team the league doesn't know, or on nothing that names a team, opens nothing", () => {
  tapTeam(page.document, "XYZ");
  tapTeam(page.document, null);
  assert.equal(page.dialog.open, false);
});

test("an open sheet redraws from the season as it is now, and a closed one is left as it was", () => {
  tapTeam(page.document, "NYY");
  season = "a new win";
  refreshTeamSheet();
  assert.equal(page.elements.teamBody.innerHTML, "<p>a new win</p>");
  page.dialog.close();
  season = "another win";
  refreshTeamSheet();
  assert.equal(page.elements.teamBody.innerHTML, "<p>a new win</p>");
});

test("the close button closes the sheet", () => {
  tapTeam(page.document, "NYY");
  const closeButton = { classList: { contains: () => false } };
  const event = new Event("click");
  Object.defineProperty(event, "target", {
    value: {
      closest: (/** @type {string} */ selector) =>
        selector === ".sheet-close" ? closeButton : null,
    },
  });
  page.dialog.dispatchEvent(event);
  assert.equal(page.dialog.open, false);
});

test("a team's button is named by what it shows, then that it opens the team, and keeps any class of what it holds", () => {
  assert.equal(
    renderTeamSheetButton({ team: "NYY", content: "Yankees" }).text,
    '<button type="button" class="team-open" data-team="NYY">Yankees<span class="spoken-only">, team details</span></button>',
  );
  assert.match(
    renderTeamSheetButton({ team: "NYY", content: "Yankees", className: "club" }).text,
    /^<button type="button" class="club team-open" data-team="NYY"/,
  );
});

test("a team's numbers leave out any it has none for, and show nothing when it has none", () => {
  const stats = /** @type {import("../shared/page/html.js").Markup} */ (
    renderTeamStats([
      ["PCT", ".574"],
      ["GB", null],
      ["Magic", 3],
    ])
  );
  assert.deepEqual(
    [
      ...stats.text.matchAll(
        /<span class="team-label">(.*?)<\/span><b class="tabular">(.*?)<\/b>/g,
      ),
    ].map(([, label, value]) => `${label} ${value}`),
    ["PCT .574", "Magic 3"],
  );
  assert.equal(renderTeamStats([["GB", null]]), false);
});

test("a team's numbers sit three to a row unless the caller asks for another count", () => {
  const readColumns = (/** @type {any} */ stats) =>
    String(stats).match(/--team-stat-columns: (\d+)/)?.[1];
  assert.equal(readColumns(renderTeamStats([["PCT", ".574"]])), "3");
  assert.equal(readColumns(renderTeamStats([["PCT", ".574"]], 5)), "5");
});

test("a team's line of facts follows its label", () => {
  assert.equal(stripTags(renderTeamDetail("Titles", html`<b>2</b> 2009`)), "Titles2 2009");
});

// What markup reads as, each separator a bar, and runs of space one.
const readText = (markup) =>
  stripTags(String(markup).replace(/&bull;/g, " | "))
    .replace(/\s+/g, " ")
    .trim();

test("a team's titles list every season up to six, beyond that the latest three and how many more, and none yet for a team without", () => {
  const titles = renderTitles([2024, 2018, 2013, 2007, 2004, 2001, 1998], "20 yrs");
  assert.equal(readText(titles), "Titles 20 yrs 7 | 2024, 2018, 2013 and 4 more");
  assert.match(titles.text, /<button type="button" class="team-titles-more">and 4 more<\/button>/);
  const six = renderTitles([2024, 2018, 2013, 2007, 2004, 2001]);
  assert.equal(readText(six), "Titles 6 | 2024, 2018, 2013, 2007, 2004, 2001");
  assert.doesNotMatch(six.text, /team-titles-more/);
  assert.match(renderTitles([]).text, /<span class="team-titles-none">None yet<\/span>/);
});

test("a tap on the titles' button lists them all until the sheet shows another team", () => {
  const readBody = () => readText(page.elements.teamBody.innerHTML);
  tapTeam(page.document, "BOS");
  tapInBody(page.elements.teamBody, false);
  assert.equal(readBody(), "Titles 7 | 2018, 2013, 2007 and 4 more");
  tapInBody(page.elements.teamBody, true);
  assert.equal(readBody(), "Titles 7 | 2018, 2013, 2007, 2004, 1918, 1916, 1915");
  refreshTeamSheet();
  assert.equal(readBody(), "Titles 7 | 2018, 2013, 2007, 2004, 1918, 1916, 1915");
  tapTeam(page.document, "NYY");
  tapTeam(page.document, "BOS");
  assert.equal(readBody(), "Titles 7 | 2018, 2013, 2007 and 4 more");
  page.dialog.close();
});

test("a sheet a reload put back open shows its team again, with every title if they were listed, and one the league doesn't know closes", () => {
  const readBody = () => readText(page.elements.teamBody.innerHTML);
  tapTeam(page.document, "BOS");
  tapInBody(page.elements.teamBody, true);
  const saved = listOpenSheets();
  tapTeam(page.document, "NYY");
  page.dialog.close();

  page.dialog.open = true;
  reopenSheets(saved);
  assert.equal(page.dialog.open, true);
  assert.equal(readBody(), "Titles 7 | 2018, 2013, 2007, 2004, 1918, 1916, 1915");
  page.dialog.close();

  page.dialog.open = true;
  reopenSheets([{ id: "teamSheet", scrollTop: 0, subject: { team: "XYZ" } }]);
  assert.equal(page.dialog.open, false);
});

test("a sheet a reload put back open hands the league's sections what they read, before filling them again", () => {
  tapTeam(page.document, "NYM");
  sectionsRead = "the Mets' roster";
  const saved = listOpenSheets();
  page.dialog.close();
  sectionsRead = "nothing read";
  filledSections.length = 0;

  page.dialog.open = true;
  reopenSheets(saved);
  assert.deepEqual(filledSections, ["took back the Mets' roster", "NYM"]);
  page.dialog.close();
});

test("a sheet's part has its title, and a note across from it only when it has one", () => {
  const part = renderSheetPart("Playoffs", html`<p>Games</p>`, "Alive");
  assert.match(part.text, /<h3>Playoffs<\/h3>\s*<span>Alive<\/span>/);
  assert.match(part.text, /<p>Games<\/p>/);
  assert.doesNotMatch(renderSheetPart("Season", html`<p>Stats</p>`).text, /<span>/);
});

test("a league fills its sections after the first for each team the sheet shows, and again as the sheet redraws", () => {
  filledSections.length = 0;
  tapTeam(page.document, "NYM");
  tapTeam(page.document, "NYY");
  refreshTeamSheet();
  assert.deepEqual(filledSections, ["NYM", "NYY", "NYY"]);
  page.dialog.close();
});
