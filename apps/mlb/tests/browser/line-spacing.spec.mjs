import { test, expect } from "./harness.mjs";
import { VIEW_GROUPS, openWithEverything } from "./views.mjs";
import { testLineSpacing } from "../../../../tests/browser/line-spacing.mjs";

testLineSpacing(test, expect, { openWithEverything, viewGroups: VIEW_GROUPS });
