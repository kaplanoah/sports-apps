import { test, expect } from "./harness.mjs";
import { VIEW_GROUPS, openWithEverything } from "./views.mjs";
import { testLineSpacing } from "../../../../tests/browser/line-spacing.mjs";

// The tabs space their own lines, like the Games list's held day headings.
const SHEET_GROUPS = Object.fromEntries(
  Object.entries(VIEW_GROUPS).filter(([group]) => group !== "the page's tabs"),
);

testLineSpacing(test, expect, { openWithEverything, viewGroups: SHEET_GROUPS });
