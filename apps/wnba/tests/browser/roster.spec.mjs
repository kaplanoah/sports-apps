import { test, expect, openApp, matchPath } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { drag } from "../../../../tests/browser/touch.mjs";
import {
  listFillFades,
  noteNameFades,
  readFilledNames,
} from "../../../../tests/browser/pill-names.mjs";
import { expectShown, readLeft } from "../../../../tests/browser/sheet-row.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listTextOffRoles, readRole } from "../../../../tests/browser/type-roles.mjs";
import { listChipsOffCenter } from "../../../../tests/browser/chip-centering.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const PHONE = { width: 390, height: 844 };
// The room between two sections side by side, which the WNBA's --sheet-gap sets.
const GAP_PX = 15;

/** @param {import("@playwright/test").Page} page */
async function openLibertySheet(page) {
  await openSeasonPart(page, "Standings");
  await page.getByRole("button", { name: "Team details: New York Liberty" }).first().click();
  const sheet = page.locator("#teamSheet");
  await expect(sheet.locator("#teamTitle")).toHaveText("New York Liberty");
  return sheet;
}

/** @param {import("@playwright/test").Page} page */
async function openLibertyRoster(page) {
  const teamSheet = await openLibertySheet(page);
  await teamSheet.getByRole("tab", { name: "Roster" }).click();
  const section = page.locator("#rosterSection");
  await expect(section.locator(".roster-coach")).toBeVisible();
  await expectShown(section);
  return section;
}

/** @param {import("@playwright/test").Locator} sheet */
const readLastNames = (sheet) => sheet.locator("table.roster tbody .roster-last").allTextContents();

/**
 * A player's row in the pinned table of numbers and names, and its row in the table of facts.
 * @param {import("@playwright/test").Locator} section
 * @param {string} lastName
 */
async function findRows(section, lastName) {
  const pinned = section.locator("table.roster-pinned tbody tr", { hasText: lastName });
  const id = await pinned.getAttribute("data-player-row");
  return { pinned, facts: section.locator(`table.roster-facts tr[data-player-row="${id}"]`) };
}

/** @param {import("@playwright/test").Locator} locator */
async function readBox(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not shown");
  return box;
}

/**
 * @param {import("@playwright/test").Locator} section
 * @param {{ left?: number, top?: number }} scroll
 */
async function scrollSection(section, scroll) {
  await section.evaluate(
    (dialog, { left, top }) =>
      new Promise((resolve) => {
        dialog.addEventListener("scroll", resolve, { once: true });
        dialog.scrollTo({ left, top, behavior: "instant" });
      }),
    scroll,
  );
}

test("a team's Roster pill shows its roster beside its stats: each player by last name, with her facts and averages, and the coach, and its Team pill goes back", async ({
  page,
}) => {
  await openApp(page);
  const section = await openLibertyRoster(page);

  await expect(page.locator("#teamTitle")).toHaveText("New York Liberty");
  await expect(page.getByRole("tab", { name: "Roster" })).toHaveAttribute("aria-selected", "true");
  await expect(section.locator("#rosterNote")).toHaveText("2026•15 players");
  expect((await readLastNames(section)).slice(0, 3)).toEqual(["Allen", "Astier", "BalogunOut"]);
  const stewart = await findRows(section, "Stewart");
  await expect(stewart.pinned.locator("td")).toHaveText(["30"]);
  await expect(stewart.facts.locator("td")).toHaveText([
    "F",
    `6'4"`,
    "Connecticut",
    "32",
    "2016",
    "42",
    "32.9",
    "20.8",
    "8.3",
    "3.3",
  ]);
  await expect(section.locator(".roster-coach")).toHaveText(/Head coach\s*Chris DeMarco/);
  const astier = await findRows(section, "Astier");
  await expect(astier.facts.locator(".roster-country")).toHaveText("France");
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listChipsOffCenter(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  await page.getByRole("tab", { name: "Team" }).click();
  await expectShown(page.locator("#teamSection"));
  await expect(section).toHaveAttribute("inert");
});

test("a roster's player numbers are facts like the ones beside them, in dim ink", async ({
  page,
}) => {
  await openApp(page);
  const section = await openLibertyRoster(page);
  const readStyle = (/** @type {import("@playwright/test").Locator} */ cell) =>
    cell.evaluate((element) => {
      const probe = element.appendChild(document.createElement("span"));
      probe.style.color = "var(--ink-dim)";
      const { fontSize, color } = getComputedStyle(element);
      const dimInk = getComputedStyle(probe).color;
      probe.remove();
      return { fontSize, isDimInk: color === dimInk };
    });

  const detail = `${(await readRole(page, "detail")).size}px`;
  expect(await readStyle(section.locator("tbody td.roster-number").first())).toEqual({
    fontSize: detail,
    isDimInk: true,
  });
  const fact = section.locator("table.roster:not(.roster-pinned) tbody td").first();
  expect((await readStyle(fact)).fontSize).toBe(detail);
});

test("a team's still top keeps its band's line as it is while a section scrolls under it", async ({
  page,
}) => {
  await openApp(page);
  const section = await openLibertyRoster(page);
  const top = page.locator("#teamSheet .sheet-top");
  const readLine = () => top.evaluate((element) => getComputedStyle(element).boxShadow);
  const line = await readLine();
  expect(line).not.toBe("none");

  await scrollSection(section, { top: 300 });
  expect(await readLine()).toBe(line);
  await expect(top).not.toHaveClass(/stuck/);
});

test("another team's sheet opens on its stats, scrolled to its top", async ({ page }) => {
  await openApp(page);
  const section = await openLibertyRoster(page);
  await scrollSection(section, { top: 300 });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Team details: Minnesota Lynx" }).first().click();

  await expect(page.locator("#teamTitle")).toHaveText("Minnesota Lynx");
  await expectShown(page.locator("#teamSection"));
  await page.getByRole("tab", { name: "Roster" }).click();
  await expectShown(section);
  expect(await section.evaluate((element) => element.scrollTop)).toBe(0);
});

test("a tap on a column's name sorts by it, the most first for an average, and a second tap reverses it, with players who haven't played last", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openLibertyRoster(page);
  const points = sheet.getByRole("columnheader", { name: "Pts" });

  await points.getByRole("button").click();
  await expect(points).toHaveAttribute("aria-sort", "descending");
  expect((await readLastNames(sheet))[0]).toBe("Stewart");
  expect((await readLastNames(sheet)).at(-1)).toBe("BalogunOut");

  await points.getByRole("button").click();
  await expect(points).toHaveAttribute("aria-sort", "ascending");
  expect((await readLastNames(sheet))[0]).toBe("Maley");
  expect((await readLastNames(sheet)).at(-1)).toBe("BalogunOut");
  await expect(sheet.getByRole("columnheader", { name: "Player" })).not.toHaveAttribute(
    "aria-sort",
  );
});

test("on a phone, swiping the roster across keeps each player's number and name, the note over the table, and the team's title in place, with a line at the names' edge, from under the note down, only once it has moved", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const section = await openLibertyRoster(page);
  const row = await findRows(section, "Stewart");
  const name = row.pinned.locator(".roster-player");
  const pinned = [
    row.pinned.locator(".roster-number"),
    name,
    section.locator("#rosterNote"),
    page.locator("#teamTitle"),
  ];
  const position = row.facts.locator("td").first();
  const readEdge = () => name.evaluate((cell) => getComputedStyle(cell, "::after").visibility);
  const before = await Promise.all([...pinned, position].map(readBox));
  expect(await readEdge()).toBe("hidden");

  await scrollSection(section, { left: 200 });

  const after = await Promise.all([...pinned, position].map(readBox));
  for (const index of pinned.keys()) expect(after[index].x).toBe(before[index].x);
  expect(after[4].x).toBeLessThan(before[4].x - 150);
  await expect.poll(readEdge).toBe("visible");
  expect(after[1].x).toBe(after[0].x + after[0].width);
  const edgeTop = await section
    .locator(".roster-bands .roster-player")
    .evaluate(
      (cell) =>
        cell.getBoundingClientRect().top + parseFloat(getComputedStyle(cell, "::after").top),
    );
  expect(edgeTop).toBe((await readBox(section.locator("#rosterBody"))).y);
});

test("on a phone, the line at the names' edge keeps 10px clear of the longest name and its Out chip", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const section = await openLibertyRoster(page);
  await expect(section.locator("table.roster .foul-chip").first()).toBeVisible();

  const gaps = await section.locator("table.roster tbody th.roster-player").evaluateAll((cells) =>
    cells.map((cell) => {
      const range = document.createRange();
      range.selectNodeContents(/** @type {Element} */ (cell.querySelector(".roster-last")));
      return cell.getBoundingClientRect().right - range.getBoundingClientRect().right;
    }),
  );
  expect(Math.min(...gaps)).toBeCloseTo(10, 0);
});

test("on a phone, the roster never springs past its edges, and at its left edge a swipe right on the table goes back to the team's stats", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const section = await openLibertyRoster(page);
  await expect(section).toHaveCSS("overscroll-behavior-x", "none");

  await (
    await drag(page, { x: 60, y: 400 }, { x: 250 })
  )();

  await expectShown(page.locator("#teamSection"));
  await expect(page.getByRole("tab", { name: "Team" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#teamSheet")).toBeVisible();
});

test("on a phone, a swipe right on the roster scrolled across scrolls the table back", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const section = await openLibertyRoster(page);
  await scrollSection(section, { left: 300 });

  await (
    await drag(page, { x: 60, y: 400 }, { x: 150 })
  )();

  await expect.poll(() => section.evaluate((element) => element.scrollLeft)).toBeLessThan(300);
  await expectShown(section);
});

test("on a phone, each row of numbers and names lines up with its row of facts, a two-line name with an Out chip's too, as the roster scrolls across and down", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const section = await openLibertyRoster(page);
  const balogun = await findRows(section, "Balogun");
  await expect(balogun.pinned.locator(".foul-chip")).toBeVisible();
  /** @param {string} table */
  const readRows = (table) =>
    section.locator(`table.${table} tr`).evaluateAll((rows) =>
      rows.map((row) => {
        const { top, height } = row.getBoundingClientRect();
        return [/** @type {HTMLElement} */ (row).dataset.playerRow, top, height];
      }),
    );

  const pinned = await readRows("roster-pinned");
  expect(pinned).toHaveLength(17);
  expect(await readRows("roster-facts")).toEqual(pinned);
  for (const scroll of [{ left: 200 }, { top: 300 }]) {
    await scrollSection(section, scroll);
    expect(await readRows("roster-facts")).toEqual(await readRows("roster-pinned"));
  }
});

test("on a phone, a swipe left on a player's facts scrolls them across under her name, which stays", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const section = await openLibertyRoster(page);
  const name = (await findRows(section, "Stewart")).pinned.locator(".roster-player");
  const before = await readBox(name);

  await (
    await drag(page, { x: 300, y: 400 }, { x: -150 })
  )();

  await expect.poll(() => section.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
  expect((await readBox(name)).x).toBe(before.x);
  await expectShown(section);
});

test("a tap on a player's facts, as on her name, opens her sheet", async ({ page }) => {
  await openApp(page);
  const section = await openLibertyRoster(page);
  const stewart = await findRows(section, "Stewart");

  await stewart.facts.locator("td").nth(2).click();

  await expect(page.locator("#playerTitle")).toHaveText("Breanna Stewart");
  await expectShown(page.locator("#playerSheet"));
});

test("on a phone, scrolling down the roster takes its note away and stops the column names 4px under the team's pills, which stay with the title", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  const section = await openLibertyRoster(page);
  const pills = page.locator("#teamSheet [role=tablist]");
  const pillsBefore = await readBox(pills);

  await scrollSection(section, { top: 400 });

  const top = await section.evaluate((element) => element.getBoundingClientRect().top);
  expect((await readBox(section.locator("table.roster-pinned .roster-head"))).y).toBe(top + 4);
  expect((await readBox(section.locator("table.roster-facts .roster-head"))).y).toBe(top + 4);
  const note = await readBox(section.locator("#rosterNote"));
  expect(note.y + note.height).toBeLessThan(top);
  expect(await readBox(pills)).toEqual(pillsBefore);
  await expect(page.locator("#teamTitle")).toBeInViewport();
});

test("on a phone, a swipe left on a team's stats shows its roster, and a swipe right on the roster goes back to its stats", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openApp(page);
  await openLibertySheet(page);
  const stats = page.locator("#teamSection");
  const roster = page.locator("#rosterSection");

  await (
    await drag(page, { x: 330, y: 400 }, { x: -250 })
  )();
  await expect(roster.locator(".roster-coach")).toBeVisible();
  await expectShown(roster);
  await expect(page.getByRole("tab", { name: "Roster" })).toHaveAttribute("aria-selected", "true");

  await (
    await drag(page, { x: 60, y: 300 }, { x: 250 })
  )();
  await expectShown(stats);
  await expect(roster).toHaveAttribute("inert");
});

test("the team's sheet opens again on its roster after a reload", async ({ page }) => {
  await openApp(page);
  await openLibertyRoster(page);

  await page.reload();

  const section = page.locator("#rosterSection");
  await expect(section.locator(".roster-coach")).toBeVisible();
  await expectShown(section);
  await expect(page.getByRole("tab", { name: "Roster" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Team" }).click();
  await expectShown(page.locator("#teamSection"));
  await expect(page.locator("#teamSheet #teamTitle")).toHaveText("New York Liberty");
});

test("a past season's team has that season's roster, with no one out", async ({ page }) => {
  await openApp(page, { pastSeasons: { 2025: (season) => ({ ...season, season: 2025 }) } });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Season" }).selectOption("2025");
  await page.keyboard.press("Escape");
  const section = await openLibertyRoster(page);

  await expect(section.locator("#rosterNote")).toHaveText(/^2025•\d+ players$/);
  await expect(section.locator("table.roster tbody tr", { hasText: "Ionescu" })).toBeVisible();
  await expect(section.locator(".foul-chip")).toHaveCount(0);
});

test.describe("in full motion", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  /**
   * Notes where the roster is on each frame, until the returned function stops and reads the
   * notes.
   * @param {import("@playwright/test").Page} page
   */
  async function startTrackingRoster(page) {
    await page.evaluate(() => {
      const roster = /** @type {HTMLElement} */ (document.getElementById("rosterSection"));
      const row = /** @type {HTMLElement} */ (roster.closest(".sheet-row"));
      const noted = /** @type {number[]} */ ([]);
      const note = () => {
        noted.push(Math.round(roster.getBoundingClientRect().x - row.getBoundingClientRect().x));
        if (!(/** @type {any} */ (window).isTrackingDone)) requestAnimationFrame(note);
      };
      requestAnimationFrame(note);
      Object.assign(window, { rosterLefts: noted, isTrackingDone: false });
    });
    return () =>
      page.evaluate(() => {
        Object.assign(window, { isTrackingDone: true });
        return /** @type {number[]} */ (/** @type {any} */ (window).rosterLefts);
      });
  }

  /** @param {number[]} lefts */
  const isMonotonic = (lefts) => {
    const steps = lefts.slice(1).map((left, index) => left - lefts[index]);
    return steps.every((step) => step >= 0) || steps.every((step) => step <= 0);
  };

  test("a tap on Roster hands the pill's fill from Team to Roster, both fading together", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openApp(page);
    await openLibertySheet(page);
    const tabList = page.locator("#teamSheet [role=tablist]");
    const readFades = await noteNameFades(tabList);

    await page.getByRole("tab", { name: "Roster" }).click();

    await expectShown(page.locator("#rosterSection"));
    expect(listFillFades(await readFades())).toEqual([
      "Roster 0.18s 0s ease-in-out",
      "Team 0.18s 0s ease-in-out",
    ]);
    expect(await readFilledNames(tabList)).toEqual(["Roster"]);
  });

  test("a team's sheet opening over another's roster shows its Team pill filled at once, fading nothing", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openApp(page);
    await openLibertyRoster(page);
    await page.keyboard.press("Escape");
    await expect(page.locator("#teamSheet")).toBeHidden();
    const tabList = page.locator("#teamSheet [role=tablist]");
    const readFades = await noteNameFades(tabList);

    await page.getByRole("button", { name: "Team details: Minnesota Lynx" }).first().click();

    await expect(page.locator("#teamTitle")).toHaveText("Minnesota Lynx");
    expect(await readFilledNames(tabList)).toEqual(["Team"]);
    expect(await readFades()).toEqual([]);
  });

  test("on a phone, a finger swiping a team's stats left brings in its roster, changing nothing but where the sections are while it moves them, and once it lifts, the pill hands off to Roster as the roster sets off and settles without stepping back", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openApp(page);
    await openLibertySheet(page);
    await expectShown(page.locator("#teamSection"));
    await page.evaluate(() => {
      const changes = /** @type {string[]} */ ([]);
      const isMoving = (/** @type {MutationRecord} */ record) =>
        record.attributeName === "style" ||
        (["class", "data-sliding"].includes(record.attributeName ?? "") &&
          /** @type {Element} */ (record.target).matches(".sheet-sections"));
      new MutationObserver((records) =>
        changes.push(
          ...records
            .filter((record) => !isMoving(record))
            .map((record) => record.attributeName ?? ""),
        ),
      ).observe(/** @type {Node} */ (document.getElementById("teamSheet")), {
        attributes: true,
        subtree: true,
      });
      Object.assign(window, { sheetChanges: changes });
    });
    const readLefts = await startTrackingRoster(page);

    const release = await drag(page, { x: 330, y: 400 }, { x: -250 }, { durationMs: 1000 });
    expect(await readFilledNames(page.locator("#teamSheet [role=tablist]"))).toEqual(["Team"]);
    expect(await page.evaluate(() => /** @type {any} */ (window).sheetChanges)).toEqual([]);
    await page.evaluate(() => {
      const roster = /** @type {HTMLElement} */ (document.getElementById("rosterSection"));
      const tab = /** @type {HTMLElement} */ (
        document.querySelector('#teamSheet [role=tab][data-tab="roster"]')
      );
      new MutationObserver(() => {
        if (tab.getAttribute("aria-selected") === "true")
          Object.assign(window, { rosterLeftAtHandoff: roster.getBoundingClientRect().x });
      }).observe(tab, { attributes: true, attributeFilter: ["aria-selected"] });
    });
    await release();
    await expect
      .poll(() => page.evaluate(() => /** @type {any} */ (window).rosterLeftAtHandoff))
      .toBeGreaterThan(30);
    await expectShown(page.locator("#rosterSection"));
    const lefts = await readLefts();

    expect(isMonotonic(lefts)).toBe(true);
    expect(lefts.at(-1)).toBe(0);
    expect(lefts[0]).toBeGreaterThan(0);
  });

  test("on a phone, a finger at the roster's left edge moves it right with the finger, and once it lifts, the roster slides on off the screen without stepping back", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openApp(page);
    const section = await openLibertyRoster(page);

    const release = await drag(page, { x: 60, y: 400 }, { x: 150 }, { durationMs: 1000 });
    expect(await readLeft(section)).toBeCloseTo(150, -1);
    const readLefts = await startTrackingRoster(page);
    await release();
    await expectShown(page.locator("#teamSection"));
    await expect.poll(() => readLeft(section)).toBe(PHONE.width + GAP_PX);
    const lefts = await readLefts();

    expect(lefts.length).toBeGreaterThan(5);
    expect(lefts.every((left, index) => index === 0 || left >= lefts[index - 1])).toBe(true);
  });

  test("on a phone, a short swipe right at the roster's left edge springs back to the roster once the finger lifts", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openApp(page);
    const section = await openLibertyRoster(page);

    const release = await drag(page, { x: 60, y: 400 }, { x: 46 }, { durationMs: 1000 });
    expect(await readLeft(section)).toBeGreaterThan(30);
    await release();

    await expectShown(section);
    await expect(page.locator("#teamSheet .sheet-sections")).not.toHaveClass(/is-swiped/);
  });
});

test("a roster that didn't load says so over Try again, which holds its shape as it reads it again", async ({
  page,
}) => {
  await openApp(page);
  /** @param {import("@playwright/test").Route} route */
  const refuse = (route) =>
    route.fulfill({ status: 502, json: { error: { code: "upstream_error", message: "test" } } });
  await page.route(matchPath("/roster"), refuse);
  const teamSheet = await openLibertySheet(page);
  await teamSheet.getByRole("tab", { name: "Roster" }).click();
  const section = page.locator("#rosterSection");
  const block = section.locator(".retry-block");
  await expect(block.locator(".retry-title")).toHaveText("The server had a problem");
  await expect(block.locator(".retry-next")).toHaveText("Try again to load roster");
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listChipsOffCenter(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  await page.unroute(matchPath("/roster"), refuse);
  const release = await holdRequests(page, matchPath("/roster"));
  await block.getByRole("button", { name: "Try again" }).click();
  await expect(section.locator(".placeholder").first()).toBeVisible();
  release();
  await expect(section.locator(".roster-coach")).toBeVisible();
  await expect(block).toHaveCount(0);
});

test("a roster that didn't load sets its icon, why, what comes next, and Try again at their own spacing", async ({
  page,
}) => {
  await openApp(page);
  await page.route(matchPath("/roster"), (route) =>
    route.fulfill({ status: 502, json: { error: { code: "upstream_error", message: "test" } } }),
  );
  const teamSheet = await openLibertySheet(page);
  await teamSheet.getByRole("tab", { name: "Roster" }).click();
  const block = page.locator("#rosterSection .retry-block");
  await expect(block.locator(".retry-next")).toBeVisible();
  const layout = await block.evaluate((element) => {
    /** @param {string} selector */
    const box = (selector) =>
      /** @type {Element} */ (element.querySelector(selector)).getBoundingClientRect();
    const [art, title, next, button] = [
      ".retry-art",
      ".retry-title",
      ".retry-next",
      ".retry-button",
    ].map(box);
    return {
      icon: [art.width, art.height],
      underIcon: title.top - art.bottom,
      underTitle: next.top - title.bottom,
      overButton: button.top - next.bottom,
      sizes: [".retry-title", ".retry-next"].map(
        (selector) =>
          getComputedStyle(/** @type {Element} */ (element.querySelector(selector))).fontSize,
      ),
    };
  });
  const detail = `${(await readRole(page, "detail")).size}px`;
  expect(layout).toEqual({
    icon: [22, 22],
    underIcon: 10,
    underTitle: 3,
    overButton: 14,
    sizes: [detail, detail],
  });
});

test("a roster read offline says so with a crossed-out signal, and loads once the phone is back online", async ({
  page,
  context,
}) => {
  await openApp(page);
  // The test's routes answer even offline, so the roster's read fails as an offline phone's does.
  /** @param {import("@playwright/test").Route} route */
  const disconnect = (route) => route.abort("internetdisconnected");
  await page.route(matchPath("/roster"), disconnect);
  await context.setOffline(true);
  const teamSheet = await openLibertySheet(page);
  await teamSheet.getByRole("tab", { name: "Roster" }).click();
  const section = page.locator("#rosterSection");
  const block = section.locator(".retry-block");
  await expect(block.locator(".retry-title")).toHaveText("Couldn't connect to the internet");
  await expect(block.locator(".retry-next")).toHaveText("Will load roster when back online");
  await expect(block.locator(".retry-art path")).toHaveAttribute("d", /^M86,152v48/);
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listChipsOffCenter(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  await page.unroute(matchPath("/roster"), disconnect);
  await context.setOffline(false);
  await expect(section.locator(".roster-coach")).toBeVisible();
  await expect(block).toHaveCount(0);
});
