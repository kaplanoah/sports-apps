import { testStreamedTabs } from "../../../../tests/browser/streamed-tabs.mjs";
import { test, expect, openApp } from "./harness.mjs";

testStreamedTabs(test, expect, { openApp, game: "1042600132" });
