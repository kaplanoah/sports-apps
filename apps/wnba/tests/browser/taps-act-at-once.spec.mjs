import { test, expect } from "./harness.mjs";
import { VIEW_GROUPS, openWithEverything } from "./views.mjs";
import { testTapsActAtOnce } from "../../../../tests/browser/taps-act-at-once.mjs";

testTapsActAtOnce(test, expect, { openWithEverything, viewGroups: VIEW_GROUPS });
