import test from "node:test";
import assert from "node:assert/strict";
import { loadThemeHead } from "./theme-head.js";
import { chooseReAddNote } from "../shared/page/re-add-note.js";

test("a picked look outranks the phone's in the classic head and the icon note", () => {
  for (const [choice, phoneLook] of /** @type {const} */ ([
    ["light", "dark"],
    ["dark", "light"],
  ])) {
    const page = loadThemeHead({ choice, phoneLook });
    const picked = page.resolveTheme(choice);
    assert.equal(picked, choice);
    assert.equal(page.theme.dataset.theme, choice);
    assert.deepEqual(
      chooseReAddNote({
        isIosApp: true,
        choice,
        picked,
        icon: phoneLook,
        isSwitched: true,
        isDismissed: false,
      }),
      { choice, picked: choice, icon: phoneLook },
    );
  }
});

test("System and an unrecognized choice follow the phone, including a later change", () => {
  for (const choice of ["auto", "sepia", ""]) {
    const page = loadThemeHead({ choice, phoneLook: "dark" });
    assert.equal(page.resolveTheme(choice), "dark");
    assert.equal(page.theme.dataset.theme, "dark");
    page.setPhoneLook("light");
    assert.equal(page.resolveTheme(choice), "light");
    page.showTheme(choice);
    assert.equal(page.theme.dataset.theme, "light");
  }
});

test("a move's icon and the first theme use the shared rule in classic script order", () => {
  const now = Date.parse("2026-10-22T16:00:00Z");
  for (const [choice, phoneLook, picked] of /** @type {const} */ ([
    ["light", "dark", "light"],
    ["dark", "light", "dark"],
    ["auto", "light", "light"],
    ["auto", "dark", "dark"],
  ])) {
    const carried = loadThemeHead().packCarried({
      at: now,
      choices: { appearance: JSON.stringify(choice) },
      icon: null,
      notifications: false,
      fromApp: true,
    });
    const page = loadThemeHead({
      phoneLook,
      now,
      href: `https://sports.example/?carried=${carried}`,
    });
    assert.equal(page.readPageMove()?.icon, picked);
    assert.equal(page.theme.dataset.theme, picked);
  }
});
