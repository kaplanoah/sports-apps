import { test, expect } from "./harness.mjs";
import { VIEW_GROUPS, openWithEverything } from "./views.mjs";
import { testDriftPresses } from "../../../../tests/browser/drift-presses.mjs";

testDriftPresses(test, expect, { openWithEverything, viewGroups: VIEW_GROUPS });
